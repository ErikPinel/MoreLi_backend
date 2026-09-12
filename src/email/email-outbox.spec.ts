import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

describe('Transactional marketplace email outbox', () => {
  let db: PGlite;
  const student = '00000000-0000-0000-0000-000000000001';
  const tutor = '00000000-0000-0000-0000-000000000002';
  const admin = '00000000-0000-0000-0000-000000000003';
  const teacher = '00000000-0000-0000-0000-000000000004';
  const inquiry = '00000000-0000-0000-0000-000000000005';

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.profiles(id uuid primary key, first_name text, last_name text, role text default 'student', contact_email text, phone text);
      create table public.teacher_profiles(id uuid primary key, user_id uuid references public.profiles(id), headline text,
        profile_status text default 'draft', verification_status text default 'unverified', updated_at timestamptz default now());
      create table public.inquiries(id uuid primary key, student_id uuid references public.profiles(id),
        teacher_id uuid references public.teacher_profiles(id), status text default 'sent',
        requested_start_at timestamptz, requested_end_at timestamptz, lesson_mode text);
    `);
    await db.exec(await readFile(new URL('../../supabase/migrations/20260912210000_no_payment_mvp_delivery.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20260913002000_hebrew_lesson_mode_labels.sql', import.meta.url), 'utf8'));
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('truncate public.email_outbox, public.teacher_review_audit, public.inquiries, public.teacher_profiles, public.profiles cascade');
    for (const [id, role] of [[student, 'student'], [tutor, 'teacher'], [admin, 'admin']]) {
      await db.query('insert into profiles(id, first_name, last_name, role, contact_email, phone) values ($1, $2, $3, $4, $5, $6)',
        [id, role, 'Test', role, `${role}@example.com`, '0500000000']);
    }
    await db.query('insert into teacher_profiles(id, user_id, headline) values ($1, $2, $3)', [teacher, tutor, 'Test tutor']);
  });

  it('queues account and teacher creation for owner and admin exactly once', async () => {
    await db.query('update profiles set contact_email = $1 where id = $2', ['student@example.com', student]);
    const result = await db.query<{ event_type: string; count: number }>('select event_type, count(*)::integer as count from email_outbox group by event_type order by event_type');
    expect(result.rows).toEqual([{ event_type: 'account.created', count: 6 }, { event_type: 'teacher.created', count: 2 }]);
  });

  it('queues all three recipients without contact disclosure before acceptance', async () => {
    await db.query('insert into inquiries(id, student_id, teacher_id) values ($1,$2,$3)', [inquiry, student, teacher]);
    const pending = await db.query<{ payload: Record<string, unknown>; audience: string }>("select payload, audience from email_outbox where event_type = 'inquiry.sent' order by audience");
    expect(pending.rows.map((row) => row.audience)).toEqual(['admin', 'student', 'teacher']);
    expect(pending.rows.every((row) => row.payload.studentEmail === null && row.payload.teacherPhone === null)).toBe(true);
    await db.query("update inquiries set status = 'viewed' where id = $1", [inquiry]);
    await db.query("update inquiries set status = 'accepted' where id = $1", [inquiry]);
    await db.query("update inquiries set status = 'accepted' where id = $1", [inquiry]);
    const accepted = await db.query<{ payload: Record<string, unknown> }>("select payload from email_outbox where event_type = 'inquiry.accepted'");
    expect(accepted.rows).toHaveLength(3);
    expect(accepted.rows[0].payload.studentEmail).toBe('student@example.com');
    expect(accepted.rows[0].payload.teacherPhone).toBe('0500000000');
  });

  it('rolls back notification jobs together with the business action', async () => {
    await db.exec('begin');
    await db.query('insert into inquiries(id, student_id, teacher_id) values ($1,$2,$3)', [inquiry, student, teacher]);
    await db.exec('rollback');
    expect((await db.query("select id from email_outbox where event_type = 'inquiry.sent'")).rows).toHaveLength(0);
  });

  it('stores Hebrew labels without changing stable modes and backfills existing jobs idempotently', async () => {
    await db.query("insert into inquiries(id, student_id, teacher_id, lesson_mode) values ($1,$2,$3,'in_person')", [inquiry, student, teacher]);
    const labels = () => db.query<{ mode: string; label: string }>("select payload->>'mode' as mode, payload->>'modeLabel' as label from email_outbox where event_type = 'inquiry.sent'");
    expect((await labels()).rows).toEqual(Array(3).fill({ mode: 'in_person', label: 'פרונטלי' }));
    await db.exec("update email_outbox set payload = payload - 'modeLabel' where event_type = 'inquiry.sent'");
    const migration = await readFile(new URL('../../supabase/migrations/20260913002000_hebrew_lesson_mode_labels.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect((await labels()).rows).toEqual(Array(3).fill({ mode: 'in_person', label: 'פרונטלי' }));
  });

  it('requires usable contact details before creating an inquiry', async () => {
    await db.query('update profiles set phone = null where id = $1', [student]);
    await expect(db.query('insert into inquiries(id, student_id, teacher_id) values ($1,$2,$3)', [inquiry, student, teacher])).rejects.toThrow('Complete your name');
  });

  it('leases jobs once, rejects stale completion, and durably retries failures', async () => {
    const claimed = await db.query<{ id: string; lease_token: string }>('select * from claim_email_jobs(20)');
    expect(claimed.rows).toHaveLength(8);
    expect((await db.query('select * from claim_email_jobs(20)')).rows).toHaveLength(0);
    const job = claimed.rows[0];
    expect((await db.query<{ finish_email_job: boolean }>('select finish_email_job($1, $2, true)', [job.id, student])).rows[0].finish_email_job).toBe(false);
    await db.query('select finish_email_job($1, $2, false)', [job.id, job.lease_token]);
    expect((await db.query<{ status: string }>('select status from email_outbox where id = $1', [job.id])).rows[0].status).toBe('pending');
    await db.query("update email_outbox set available_at = now() - interval '1 minute' where id = $1", [job.id]);
    const retry = await db.query<{ id: string; lease_token: string; attempts: number }>('select * from claim_email_jobs(20)');
    expect(retry.rows[0].attempts).toBe(2);
    await db.query('select finish_email_job($1, $2, true)', [job.id, retry.rows[0].lease_token]);
    expect((await db.query<{ status: string }>('select status from email_outbox where id = $1', [job.id])).rows[0].status).toBe('sent');
  });

  it('rejects non-admin review decisions and records actionable admin rejection', async () => {
    await db.query("update teacher_profiles set profile_status = 'pending' where id = $1", [teacher]);
    await expect(db.query('select * from reject_teacher_review($1,$2,$3)', [teacher, student, 'Please complete your bio'])).rejects.toThrow('Administrator required');
    await db.query('select * from reject_teacher_review($1,$2,$3)', [teacher, admin, 'Please complete your bio']);
    const decision = await db.query<{ actor_id: string; reason: string }>("select actor_id, reason from teacher_review_audit where next_status = 'draft'");
    expect(decision.rows[0]).toEqual({ actor_id: admin, reason: 'Please complete your bio' });
    expect((await db.query("select id from email_outbox where event_type = 'teacher.rejected'")).rows).toHaveLength(2);
  });
});