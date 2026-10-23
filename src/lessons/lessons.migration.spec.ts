import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';

describe('Persistent owned lessons', () => {
  let db: PGlite;
  const teacher = '00000000-0000-0000-0000-000000000001';
  const owner = '00000000-0000-0000-0000-000000000002';
  const student = '00000000-0000-0000-0000-000000000003';
  const stranger = '00000000-0000-0000-0000-000000000004';
  const inquiry = '00000000-0000-0000-0000-000000000005';
  const pastInquiry = '00000000-0000-0000-0000-000000000006';
  const completedInquiry = '00000000-0000-0000-0000-000000000007';
  const unscheduledInquiry = '00000000-0000-0000-0000-000000000008';
  const key = '00000000-0000-0000-0000-000000000009';
  const future = DateTime.now().setZone('Asia/Jerusalem').startOf('week').plus({ weeks: 1, days: 6 }).set({ hour: 10 });
  let before: unknown[];
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key);
      create table teacher_profiles(id uuid primary key,user_id uuid,availability_customized boolean not null default false);
      create table teacher_availability(teacher_id uuid,day_of_week int,start_time time,end_time time,is_active boolean);
      create table inquiries(id uuid primary key,teacher_id uuid,student_id uuid,status text,requested_start_at timestamptz,requested_end_at timestamptz,
        lesson_mode text,created_at timestamptz default now(),responded_at timestamptz);
      create table reviews(id uuid default gen_random_uuid(),inquiry_id uuid,student_id uuid,teacher_id uuid);
      create type notification_type as enum ('lesson_updated');
      create table notifications(user_id uuid,type notification_type,title text,body text,entity_type text,entity_id uuid);
      create table test_mail(kind text,recipient uuid,payload jsonb,key text unique);
      create table support_tickets(id uuid primary key,user_id uuid);
      create function enqueue_marketplace_email(text,uuid,uuid,text,jsonb,text) returns void language sql as $$
        insert into public.test_mail values($1,$3,$5,$6||':'||$4) on conflict do nothing $$;
      create function create_context_support_ticket(uuid,uuid,text,text,text,uuid,uuid,uuid) returns jsonb language sql as $$
        insert into public.support_tickets values($2,$1) returning to_jsonb(support_tickets.*) $$;`);
    await db.query('insert into profiles values($1),($2),($3)', [owner, student, stranger]);
    await db.query('insert into teacher_profiles(id,user_id) values($1,$2)', [teacher, owner]);
    for (const migration of ['20261021222000_lesson_lifecycle.sql', '20261021225000_future_lesson_acceptance.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    await db.query(`insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at,lesson_mode)
      values($1,$2,$3,'accepted',$4,$5,'online')`, [inquiry, teacher, student, future.toISO(), future.plus({ hours: 1 }).toISO()]);
    await db.query(`insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at,lesson_mode)
      values($1,$2,$3,'accepted',now()-interval '2 hours',now()-interval '1 hour','in_person'),
      ($4,$2,$3,'accepted',now()-interval '26 hours',now()-interval '25 hours','online'),
      ($5,$2,$3,'accepted',null,null,null)`, [pastInquiry, teacher, student, completedInquiry, unscheduledInquiry]);
    await db.query(`update inquiries set lesson_status='completed',student_completed_at=now()-interval '1 hour',
      teacher_completed_at=now()-interval '30 minutes',lesson_note='Recorded completion' where id=$1`, [completedInquiry]);
    before = (await db.query('select * from inquiries order by id')).rows;
    await db.exec(await readFile(new URL('../../supabase/migrations/20261023180000_persistent_lessons.sql', import.meta.url), 'utf8'));
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin'); });
  afterEach(async () => { await db.exec('rollback'); });
  const create = (start = future.plus({ hours: 2 }), who = owner, learner = student, request = key) =>
    db.query<{ id: string; status: string }>('select * from save_teacher_lesson($1,$2,$3,$4,$5,$6,null)', [who, request, learner, start.toISO(), start.plus({ hours: 1 }).toISO(), 'online']);
  const source = async (id = inquiry) => (await db.query<{ id: string }>('select id from lessons where source_inquiry_id=$1', [id])).rows[0].id;
  const action = (id: string, user: string, kind: string, note = '') => db.query('select * from update_scheduled_lesson_state($1,$2,$3,$4)', [user, id, kind, note]);
  async function rejects(run: () => Promise<unknown>, reason: string) {
    await db.exec('savepoint expected_failure');
    try { await expect(run()).rejects.toThrow(reason); }
    finally { await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure'); }
  }

  it('silently backfills exactly one lesson per accepted inquiry without rewriting recorded decisions', async () => {
    expect((await db.query('select * from inquiries order by id')).rows).toEqual(before);
    expect((await db.query('select * from lessons')).rows).toHaveLength(4);
    expect((await db.query('select * from notifications')).rows).toHaveLength(0);
    expect((await db.query('select * from test_mail')).rows).toHaveLength(0);
    expect((await db.query("select * from lessons where status='completed'")).rows).toHaveLength(1);
    expect((await db.query("select * from lessons where status='needs_scheduling'")).rows).toHaveLength(1);
  });
  it('creates an immediately scheduled additional lesson and exactly one student email and notification across retries', async () => {
    const created = (await create()).rows[0];
    expect(created.status).toBe('scheduled');
    expect((await create()).rows[0].id).toBe(created.id);
    expect((await db.query('select * from notifications')).rows).toMatchObject([{ user_id: student, entity_type: 'lesson', entity_id: created.id }]);
    expect((await db.query('select * from test_mail')).rows).toMatchObject([{ recipient: student, kind: 'lesson.changed', payload: { action: 'scheduled' } }]);
    expect((await db.query('select * from inquiries')).rows).toHaveLength(4);
    await rejects(() => create(future.plus({ hours: 3 })), 'LESSON_REQUEST_KEY_REUSED');
  });
  it('requires a teacher-owned accepted connection and rejects self-booking and unrelated actors', async () => {
    await rejects(() => create(future.plus({ hours: 2 }), stranger), 'LESSON_CONNECTION_REQUIRED');
    await rejects(() => create(future.plus({ hours: 2 }), owner, stranger), 'LESSON_CONNECTION_REQUIRED');
    const id = await source();
    await rejects(() => action(id, stranger, 'cancel', 'Cannot attend'), 'Lesson not found');
  });
  it('prevents double booking, retains adjacent slots, and releases cancelled slots', async () => {
    await rejects(() => create(future.plus({ minutes: 30 })), 'LESSON_CONFLICT');
    await create(future.plus({ hours: 1 }));
    await action(await source(), student, 'cancel', 'Cannot attend this time');
    await create(future, owner, student, '00000000-0000-0000-0000-000000000010');
    expect((await db.query('select * from test_mail')).rows).toHaveLength(3);
  });
  it('enforces student conflicts even across different teachers', async () => {
    const otherTeacher = '00000000-0000-0000-0000-000000000011';
    const otherInquiry = '00000000-0000-0000-0000-000000000012';
    await db.query('insert into teacher_profiles(id,user_id) values($1,$2)', [otherTeacher, stranger]);
    await db.query("insert into inquiries(id,teacher_id,student_id,status,lesson_mode) values($1,$2,$3,'accepted','online')", [otherInquiry, otherTeacher, student]);
    await rejects(() => create(future, stranger), 'LESSON_CONFLICT');
  });
  it('creates the first lesson atomically on acceptance, once, and rolls back an overlapping acceptance', async () => {
    const pending = '00000000-0000-0000-0000-000000000013';
    await db.query(`insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at,lesson_mode)
      values($1,$2,$3,'sent',$4,$5,'online')`, [pending, teacher, stranger, future.plus({ hours: 2 }).toISO(), future.plus({ hours: 3 }).toISO()]);
    await create();
    await rejects(() => db.query("update inquiries set status='accepted' where id=$1", [pending]), 'LESSON_CONFLICT');
    expect((await db.query<{ status: string }>('select status from inquiries where id=$1', [pending])).rows[0].status).toBe('sent');
    const added = (await db.query<{ id: string }>('select id from lessons where request_key=$1', [key])).rows[0].id;
    await action(added, owner, 'cancel', 'Choose another student');
    await db.query("update inquiries set status='accepted' where id=$1", [pending]);
    await db.query("update inquiries set status='accepted' where id=$1", [pending]);
    expect((await db.query('select * from lessons where source_inquiry_id=$1', [pending])).rows).toHaveLength(1);
  });
  it('keeps legacy lifecycle links synchronized and requires two explicit confirmations', async () => {
    const lessonId = await source(pastInquiry);
    await action(lessonId, student, 'confirm_completed');
    await action(lessonId, student, 'confirm_completed');
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
    await db.query("select * from update_lesson_state($1,$2,'confirm_completed','')", [owner, pastInquiry]);
    expect((await db.query<{ status: string }>('select status from lessons where id=$1', [lessonId])).rows[0].status).toBe('completed');
    expect((await db.query<{ lesson_status: string }>('select lesson_status from inquiries where id=$1', [pastInquiry])).rows[0].lesson_status).toBe('completed');
  });
  it('does not infer completion from time, permits only reasoned cancellation, and does not turn no-shows into attendance', async () => {
    const id = await source();
    await rejects(() => action(id, student, 'confirm_completed'), 'LESSON_COMPLETION_NOT_ALLOWED');
    await rejects(() => action(id, student, 'cancel'), 'LESSON_REASON_REQUIRED');
    const past = await source(pastInquiry);
    await action(past, owner, 'report_no_show', 'Student did not attend');
    expect((await db.query<{ status: string }>('select status from lessons where id=$1', [past])).rows[0].status).toBe('no_show_reported');
  });
  it('preserves custom closed schedules instead of restoring defaults', async () => {
    await db.query('update teacher_profiles set availability_customized=true where id=$1', [teacher]);
    await rejects(() => create(), 'LESSON_OUTSIDE_AVAILABILITY');
  });
  it('limits lesson support context to the participants and retains the exact additional lesson', async () => {
    const lesson = (await create()).rows[0];
    const result = await db.query<{ result: { lesson_id: string } }>(
      "select create_lesson_support_ticket($1,$2,'support','Lesson help','Please investigate this lesson',$3) as result",
      [student, key, lesson.id]);
    expect(result.rows[0].result.lesson_id).toBe(lesson.id);
    expect((await db.query<{ lesson_id: string }>('select lesson_id from support_tickets')).rows[0].lesson_id).toBe(lesson.id);
    await rejects(() => db.query("select create_lesson_support_ticket($1,$2,'support','Lesson help','Please investigate this lesson',$3)", [stranger, '00000000-0000-0000-0000-000000000014', lesson.id]), 'Lesson not found');
  });
  it('allows a review after a completed additional lesson even when the original lesson was cancelled', async () => {
    const connection = '00000000-0000-0000-0000-000000000015';
    await db.query(`insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at,lesson_mode)
      values($1,$2,$3,'accepted',$4,$5,'online')`, [connection, teacher, stranger, future.plus({ hours: 4 }).toISO(), future.plus({ hours: 5 }).toISO()]);
    await action(await source(connection), owner, 'cancel', 'Original time did not work');
    const added = (await create(future.plus({ hours: 5 }), owner, stranger)).rows[0].id;
    // Advance only this fixture's clock-relative dates; the booking itself was validated above.
    await db.exec('alter table lessons disable trigger guard_scheduled_lesson');
    await db.query("update lessons set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1", [added]);
    await db.exec('alter table lessons enable trigger guard_scheduled_lesson');
    const review = () => db.query('insert into reviews(inquiry_id,student_id,teacher_id) values($1,$2,$3)', [connection, stranger, teacher]);
    await rejects(review, 'both participants');
    await action(added, stranger, 'confirm_completed');
    await rejects(review, 'both participants');
    await action(added, owner, 'confirm_completed');
    await review();
    expect((await db.query<{ lesson_status: string }>('select lesson_status from inquiries where id=$1', [connection])).rows[0].lesson_status).toBe('cancelled');
    expect((await db.query('select * from reviews')).rows).toHaveLength(1);
  });
  it('reschedules once, updates the legacy first lesson, and rejects unsupported times', async () => {
    const id = await source();
    const change = (start: DateTime) => db.query('select * from save_teacher_lesson($1,$2,$3,$4,$5,$6,$7)', [owner, key, student, start.toISO(), start.plus({ hours: 1 }).toISO(), 'online', id]);
    const start = future.plus({ hours: 3 });
    await change(start);
    await change(start);
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
    expect((await db.query<{ payload: { action: string } }>('select payload from test_mail')).rows[0].payload.action).toBe('rescheduled');
    expect((await db.query<{ requested_start_at: Date }>('select requested_start_at from inquiries where id=$1', [inquiry])).rows[0].requested_start_at).toEqual(new Date(start.toISO()!));
    await rejects(() => change(future.set({ hour: 22 })), 'LESSON_OUTSIDE_AVAILABILITY');
    await rejects(() => change(future.plus({ days: 5 })), 'LESSON_OUTSIDE_AVAILABILITY');
  });
});
