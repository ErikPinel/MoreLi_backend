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
  const config = new ConfigService({ email: { resendApiKey: 'test-key', senderEmail: 'sender@example.com' } });
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

  it('does not start queue processing with the restricted Resend test sender', async () => {
    const process = vi.fn();
    const runner = new EmailDeliveryRunner({ process } as unknown as EmailOutboxService, new ConfigService({ email: { resendApiKey: 'test-key', senderEmail: 'onboarding@resend.dev' } }));
    runner.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(process).not.toHaveBeenCalled();
    await runner.onApplicationShutdown();
  });
});

describe('Email rendering and retries', () => {
  it.each(['student', 'teacher'] as const)('links canonical lesson updates to the %s lesson view and escapes notes', (audience) => {
    const rendered = renderEmail({ ...job, audience, event_type: 'lesson.changed', entity_id: 'lesson-1',
      payload: { action: 'scheduled', status: 'scheduled', start: '2026-10-25T08:00:00Z', mode: 'in_person', note: '<script>note</script>' } }, 'https://example.com');
    expect(rendered.text).toContain(`/${audience}/lessons/lesson-1`);
    expect(rendered.text).toContain('אין צורך באישור נוסף');
    expect(rendered.text).toContain('אין חיוב אוטומטי');
    expect(rendered.text).toContain('פרונטלי');
    expect(rendered.text).not.toContain('/inquiries');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html.match(/<a /g)).toHaveLength(1);
  });

  it('distinguishes rescheduling and preserves queued legacy lesson updates', () => {
    const changed = renderEmail({ ...job, event_type: 'lesson.changed', payload: { action: 'rescheduled', mode: 'online' } }, 'https://example.com');
    expect(changed.subject).toContain('עדכן את מועד השיעור');
    const legacy = renderEmail({ ...job, event_type: 'lesson.updated' }, 'https://example.com');
    expect(legacy.text).toContain('/teacher/inquiries/inquiry-1');
  });

  it.each(['inquiry.sent', 'inquiry.accepted', 'inquiry.declined'])('distinguishes all recipient roles for %s', (event_type) => {
    const subjects = ['student', 'teacher', 'admin'].map((audience) => renderEmail({ ...job, event_type, audience: audience as EmailJob['audience'] }, 'https://example.com').subject);
    expect(new Set(subjects).size).toBe(3);
  });

  it('includes payment review details and one authenticated review link', () => {
    const rendered = renderEmail({ ...job, audience: 'admin', event_type: 'billing.requested', entity_id: 'payment-1', created_at: '2026-10-22T19:48:19Z',
      payload: { teacherName: 'Tutor', reference: 'BIT-123', amount: '60' } }, 'https://example.com');
    expect(rendered.text).toContain('BIT-123');
    expect(rendered.text).toContain('payment-1');
    expect(rendered.text).toContain('22:48:19');
    expect(rendered.text).toContain('60');
    expect(rendered.html.match(/<a /g)).toHaveLength(1);
    expect(rendered.html).toContain('/admin?payment=payment-1#payments');
    expect(rendered.html).toContain('<br />');
    expect(rendered.html).not.toContain('decision=');
  });

  it('links administrator actions to authenticated event screens, never mutation GET endpoints', () => {
    for (const [event_type, parameter] of [['teacher.pending','teacher='],['billing.requested','payment='],['support.created','ticket=']] as const) {
      const rendered = renderEmail({ ...job, audience: 'admin', event_type, payload: { name: '<script>name</script>', subject: 'Help', reference: 'BIT-reference' } }, 'https://example.com');
      expect(rendered.html).toContain(`/admin?${parameter}`);
      expect(rendered.html).not.toContain('/approve?');
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('אישור מפורש');
    }
  });
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
    const snapshot = { to: ['teacher@example.com'], subject: 'Subject', text: 'Text', html: '<p>Text</p>' };
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null }).mockResolvedValueOnce({ data: snapshot, error: null }).mockResolvedValueOnce({ data: true, error: null });
    const lt = vi.fn().mockResolvedValue({ error: null });
    const supabase = { client: { rpc, from: (table: string) => table === 'email_suppressions' ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) } : { delete: () => ({ in: () => ({ lt }) }) } } } as unknown as SupabaseService;
    const delivery = { isConfigured: () => true, isTestSender: () => false, prepareJob: () => snapshot, sendJob: vi.fn().mockResolvedValue({ accepted: false, retryable: true, errorCode: 'network_or_timeout' }) } as unknown as EmailService;
    const worker = new EmailOutboxService(supabase, delivery, new ConfigService({ publicAppUrl: 'https://example.com' }));
    await expect(worker.process()).resolves.toEqual({ processed: 1, sent: 0, retried: 1, failed: 0 });
    expect(rpc).toHaveBeenLastCalledWith('finish_resend_job', { p_id: job.id, p_lease: job.lease_token, p_success: false, p_message_id: null, p_retryable: true, p_error_code: 'network_or_timeout', p_retry_after: null });
  });

  it('retains explicit admin processing without cron credentials', () => {
    const worker = { process: vi.fn() } as unknown as EmailOutboxService;
    const controller = new EmailOutboxController(worker);
    expect(worker.process).not.toHaveBeenCalled();
    controller.process();
    expect(worker.process).toHaveBeenCalledOnce();
  });

  it('does not claim queue jobs in test-sender mode, including manual admin processing', async () => {
    const rpc = vi.fn();
    const worker = new EmailOutboxService({ client: { rpc } } as unknown as SupabaseService,
      { isConfigured: () => true, isTestSender: () => true } as unknown as EmailService, new ConfigService());
    await expect(worker.process()).rejects.toMatchObject({ status: 503 });
    expect(rpc).not.toHaveBeenCalled();
  });
});