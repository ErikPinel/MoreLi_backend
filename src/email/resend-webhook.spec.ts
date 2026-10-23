import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { SupabaseService } from '../database/supabase.service.js';
import { ResendWebhookController } from './resend-webhook.controller.js';

describe('Signed Resend webhook ingestion', () => {
  const signingBytes = Buffer.from('deterministic-test-signing-key-32-bytes');
  const config = new ConfigService({ email: { webhookSecret: `whsec_${signingBytes.toString('base64')}` } });
  const jobId = '00000000-0000-0000-0000-000000000001';
  const payload = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'provider-id', tags: { outbox_id: jobId } } });
  const request = (body = payload) => {
    const id = 'msg_test_receipt';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', signingBytes).update(`${id}.${timestamp}.${payload}`).digest('base64');
    return { body: Buffer.from(body), headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } } as unknown as Request;
  };

  it('verifies the raw body before persisting a receipt and returns duplicate results safely', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const controller = new ResendWebhookController(config, { client: { rpc } } as unknown as SupabaseService);
    await expect(controller.receive(request())).resolves.toEqual({ recorded: true });
    expect(rpc).toHaveBeenCalledWith('record_resend_event', expect.objectContaining({ p_event_id: 'msg_test_receipt', p_message_id: 'provider-id', p_job_id: jobId, p_type: 'email.delivered' }));
    await expect(controller.receive(request())).resolves.toEqual({ recorded: false });
  });

  it('rejects tampering or missing signatures before touching the database', async () => {
    const rpc = vi.fn();
    const controller = new ResendWebhookController(config, { client: { rpc } } as unknown as SupabaseService);
    await expect(controller.receive(request(`${payload} `))).rejects.toMatchObject({ status: 401 });
    await expect(controller.receive({ body: Buffer.from(payload), headers: {} } as Request)).rejects.toMatchObject({ status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not acknowledge a database failure or accept unconfigured webhook verification', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'unavailable' } });
    await expect(new ResendWebhookController(config, { client: { rpc } } as unknown as SupabaseService).receive(request())).rejects.toMatchObject({ status: 503 });
    await expect(new ResendWebhookController(new ConfigService(), {} as SupabaseService).receive(request())).rejects.toMatchObject({ status: 503 });
  });
});