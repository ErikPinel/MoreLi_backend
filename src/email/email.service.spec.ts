import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

describe('Resend delivery adapter', () => {
  const config = new ConfigService({ email: { resendApiKey: 'test-key', senderEmail: 'mail@example.com', senderName: 'MoreLi', adminEmail: 'support@example.com' } });
  const job = { id: 'outbox-job', email: 'recipient@example.com', subject: 'Subject', text: 'Message', html: '<p>Message</p>' };
  beforeEach(() => { send.mockReset(); });

  it('uses a stable provider idempotency key and records provider acceptance', async () => {
    send.mockResolvedValue({ data: { id: 'provider-id' }, error: null, headers: {} });
    const service = new EmailService(config);
    await expect(service.sendJob(job)).resolves.toEqual({ accepted: true, retryable: false, messageId: 'provider-id' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'MoreLi <mail@example.com>', to: ['recipient@example.com'], tags: expect.arrayContaining([{ name: 'outbox_id', value: job.id }]) }), expect.objectContaining({ idempotencyKey: 'moreli/outbox-job', signal: expect.any(AbortSignal) }));
  });

  it('honors rate-limit retry hints and does not classify failure as sent', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429 }, headers: { 'retry-after': '30' } });
    await expect(new EmailService(config).sendJob(job)).resolves.toEqual({ accepted: false, retryable: true, errorCode: 'rate_limit_exceeded', retryAfterSeconds: 30 });
  });

  it('does not keep retrying invalid recipients or invalid idempotent payloads', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422 }, headers: {} });
    await expect(new EmailService(config).sendJob(job)).resolves.toMatchObject({ accepted: false, retryable: false });
  });

  it('retains unknown network outcomes for durable retry', async () => {
    send.mockRejectedValue(new Error('private network details'));
    await expect(new EmailService(config).sendJob(job)).resolves.toEqual({ accepted: false, retryable: true, errorCode: 'network_or_timeout' });
  });

  it('does not call Resend without configured sender credentials', async () => {
    const service = new EmailService(new ConfigService());
    expect(service.isConfigured()).toBe(false);
    await expect(service.sendJob(job)).resolves.toMatchObject({ accepted: false, errorCode: 'configuration_missing' });
    expect(send).not.toHaveBeenCalled();
  });

  it('restricts test-sender messages to the configured admin inbox without calling Resend for others', async () => {
    const service = new EmailService(new ConfigService({ email: { resendApiKey: 'test-key', senderEmail: 'onboarding@resend.dev', adminEmail: 'owner@example.com' } }));
    expect(service.isTestSender()).toBe(true);
    await expect(service.sendJob(job)).resolves.toMatchObject({ accepted: false, retryable: true, errorCode: 'test_sender_recipient_restricted' });
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValue({ data: { id: 'test-message-id' }, error: null, headers: {} });
    await expect(service.sendJob({ ...job, email: 'owner@example.com' })).resolves.toMatchObject({ accepted: true, messageId: 'test-message-id' });
  });

  it('allows a separate owner test inbox without changing the admin reply-to or sending to that admin', async () => {
    const service = new EmailService(new ConfigService({ email: { resendApiKey: 'test-key', senderEmail: 'onboarding@resend.dev', adminEmail: 'admin@example.com', testRecipientEmail: 'owner@example.com' } }));
    await expect(service.sendJob({ ...job, email: 'admin@example.com' })).resolves.toMatchObject({ accepted: false, errorCode: 'test_sender_recipient_restricted' });
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValue({ data: { id: 'owner-test-id' }, error: null, headers: {} });
    await expect(service.sendJob({ ...job, email: 'owner@example.com' })).resolves.toMatchObject({ accepted: true });
    expect(send.mock.calls[0][0]).toMatchObject({ to: ['owner@example.com'], replyTo: 'admin@example.com' });
  });
});