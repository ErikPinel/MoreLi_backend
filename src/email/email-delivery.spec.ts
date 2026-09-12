import { ConfigService } from '@nestjs/config';
import { EmailJob } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { EmailOutboxController } from './email-outbox.controller.js';
import { EmailOutboxService, renderEmail } from './email-outbox.service.js';
import { EmailService } from './email.service.js';
import { EmailDeliveryRunner } from './email-delivery-runner.js';

const job = {
  id: 'job-1', entity_id: 'inquiry-1', event_type: 'inquiry.accepted', audience: 'teacher',
  recipient_email: 'teacher@example.com', lease_token: 'lease-1',
  payload: { studentName: '<script>student</script>', teacherName: 'Tutor', studentEmail: 'student@example.com', studentPhone: '0500000000', teacherEmail: 'teacher@example.com', teacherPhone: '0520000000', start: '2030-01-01T14:00:00Z', mode: 'online' },
} as EmailJob;

describe('Automatic server email delivery', () => {
  const config = new ConfigService({ email: { brevoApiKey: 'test-key', senderEmail: 'sender@example.com' } });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts immediately, runs again automatically, and stops on shutdown', async () => {
    const process = vi.fn().mockResolvedValue({ processed: 0, sent: 0, retried: 0 });
    const runner = new EmailDeliveryRunner({ process } as unknown as EmailOutboxService, config);
    expect(process).not.toHaveBeenCalled();
    runner.start();
    runner.start();
    expect(process).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(process).toHaveBeenCalledTimes(2);
    await runner.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(10000);
    expect(process).toHaveBeenCalledTimes(2);
  });

  it('never overlaps batches and waits for active delivery on shutdown', async () => {
    let finish!: (value: { processed: number; sent: number; retried: number }) => void;
    const process = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const runner = new EmailDeliveryRunner({ process } as unknown as EmailOutboxService, config);
    runner.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(process).toHaveBeenCalledOnce();
    let closed = false;
    const shutdown = runner.onApplicationShutdown().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish({ processed: 1, sent: 1, retried: 0 });
    await shutdown;
    await vi.advanceTimersByTimeAsync(10000);
    expect(process).toHaveBeenCalledOnce();
  });

  it('recovers from database failure without an unhandled rejection', async () => {
    const process = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ processed: 0, sent: 0, retried: 0 });
    const runner = new EmailDeliveryRunner({ process } as unknown as EmailOutboxService, config);
    runner.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(process).toHaveBeenCalledTimes(2);
    await runner.onApplicationShutdown();
  });

  it('does not consume retry attempts when email is not configured', async () => {
    const process = vi.fn();
    const runner = new EmailDeliveryRunner({ process } as unknown as EmailOutboxService, new ConfigService());
    runner.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(process).not.toHaveBeenCalled();
    await runner.onApplicationShutdown();
  });
});

describe('Email rendering and retries', () => {
  it('renders frontal lessons for both existing and labeled database jobs', () => {
    for (const modeLabel of [undefined, 'פרונטלי']) {
      const message = renderEmail({ ...job, payload: { ...job.payload as object, mode: 'in_person', ...(modeLabel ? { modeLabel } : {}) } }, 'https://example.com');
      expect(message.text).toContain('פרונטלי');
      expect(message.text).not.toContain('פנים אל פנים');
    }
  });
  it('reveals only the other participant contact details after acceptance and escapes HTML', () => {
    const message = renderEmail(job, 'https://example.com');
    expect(message.text).toContain('student@example.com');
    expect(message.text).not.toContain('teacher@example.com');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.text).toContain('/teacher/inquiries');
  });

  it.each(['inquiry.sent', 'inquiry.declined'])('does not disclose contacts in %s messages', (event) => {
    for (const audience of ['student', 'teacher', 'admin'] as const) {
      const message = renderEmail({ ...job, event_type: event, audience }, 'https://example.com');
      expect(message.text).not.toContain('student@example.com');
      expect(message.text).not.toContain('0500000000');
      expect(message.text).not.toContain('teacher@example.com');
    }
  });

  it('acknowledges failed delivery as failure for durable retry, not success', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValueOnce({ data: true, error: null });
    const lt = vi.fn().mockResolvedValue({ error: null });
    const supabase = { client: { rpc, from: () => ({ delete: () => ({ in: () => ({ lt }) }) }) } } as unknown as SupabaseService;
    const delivery = { deliverJob: vi.fn().mockResolvedValue(false) } as unknown as EmailService;
    const worker = new EmailOutboxService(supabase, delivery, new ConfigService({ publicAppUrl: 'https://example.com' }));
    await expect(worker.process()).resolves.toEqual({ processed: 1, sent: 0, retried: 1 });
    expect(rpc).toHaveBeenLastCalledWith('finish_email_job', { p_id: job.id, p_lease: job.lease_token, p_success: false });
  });

  it('retains explicit admin processing without cron credentials', () => {
    const worker = { process: vi.fn() } as unknown as EmailOutboxService;
    const controller = new EmailOutboxController(worker);
    expect(worker.process).not.toHaveBeenCalled();
    controller.process();
    expect(worker.process).toHaveBeenCalledOnce();
  });
});