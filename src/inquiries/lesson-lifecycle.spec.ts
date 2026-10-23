import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

describe('Owned lesson lifecycle and completion-based reviews',()=>{
  let db:PGlite;
  const teacher='00000000-0000-0000-0000-000000000001';
  const owner='00000000-0000-0000-0000-000000000002';
  const student='00000000-0000-0000-0000-000000000003';
  const stranger='00000000-0000-0000-0000-000000000004';
  const inquiry='00000000-0000-0000-0000-000000000005';
  const other='00000000-0000-0000-0000-000000000006';
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table public.teacher_profiles(id uuid primary key,user_id uuid);
      create table public.inquiries(id uuid primary key,teacher_id uuid,student_id uuid,status text,requested_start_at timestamptz,requested_end_at timestamptz);
      create table public.reviews(id uuid default gen_random_uuid(),inquiry_id uuid,student_id uuid,teacher_id uuid);
      create table public.notifications(user_id uuid,type text,title text,body text,entity_type text,entity_id uuid);
      create table public.test_mail(kind text,key text unique);
      create function public.enqueue_marketplace_email(p_kind text,p_entity uuid,p_recipient uuid,p_audience text,p_payload jsonb,p_key text) returns void language sql as $$ insert into public.test_mail values(p_kind,p_key||':'||p_audience) on conflict do nothing $$;`);
    await db.query('insert into teacher_profiles values($1,$2)',[teacher,owner]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021222000_lesson_lifecycle.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021225000_future_lesson_acceptance.sql',import.meta.url),'utf8'));
  },30000);
  afterAll(async()=>{await db.close();});
  beforeEach(async()=>{
    await db.exec('delete from reviews;delete from inquiries;delete from notifications;delete from test_mail;');
    await db.query("insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at) values($1,$2,$3,'accepted',now()-interval '2 hours',now()-interval '1 hour')",[inquiry,teacher,student]);
  });
  const action=(user:string,kind:string,note='')=>db.query('select * from update_lesson_state($1,$2,$3,$4)',[user,inquiry,kind,note]);
  const review=()=>db.query('insert into reviews(inquiry_id,student_id,teacher_id) values($1,$2,$3)',[inquiry,student,teacher]);
  it('requires explicit confirmation from both participants and preserves idempotency',async()=>{
    await expect(review()).rejects.toThrow('both participants');
    await action(student,'confirm_completed');
    await expect(review()).rejects.toThrow('both participants');
    await action(student,'confirm_completed');
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
    const result=await action(owner,'confirm_completed');
    expect(result.rows[0].lesson_status).toBe('completed');
    await review();
    expect((await db.query('select * from reviews')).rows).toHaveLength(1);
  });
  it('does not infer attendance from elapsed time or permit future completion',async()=>{
    expect((await db.query<{lesson_status:string}>('select lesson_status from inquiries')).rows[0].lesson_status).toBe('awaiting');
    await db.exec("update inquiries set requested_start_at=now()+interval '1 day',requested_end_at=now()+interval '25 hours'");
    await expect(action(student,'confirm_completed')).rejects.toThrow('selected lesson end');
  });
  it('enforces participant ownership and requires a cancellation reason',async()=>{
    await expect(action(stranger,'cancel','A reason')).rejects.toThrow('Lesson not found');
    await expect(action(student,'cancel','')).rejects.toThrow('cancellation reason');
    await action(student,'cancel','Cannot attend the selected time');
    await expect(action(owner,'confirm_completed')).rejects.toThrow('selected lesson end');
  });
  it('records no-show as a report rather than a proven completed lesson',async()=>{
    const result=await action(owner,'report_no_show','Student did not attend');
    expect(result.rows[0].lesson_status).toBe('no_show_reported');
    await expect(review()).rejects.toThrow('both participants');
  });
  it('rejects overlapping accepted lessons without blocking after cancellation',async()=>{
    await db.exec("update inquiries set requested_start_at=now()+interval '1 day',requested_end_at=now()+interval '25 hours'");
    await db.query("insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at) values($1,$2,$3,'sent',now()+interval '24 hours 30 minutes',now()+interval '25 hours 30 minutes')",[other,teacher,stranger]);
    await expect(db.query("update inquiries set status='accepted' where id=$1",[other])).rejects.toThrow('conflicts');
    await action(student,'cancel','Changed my learning schedule');
    await db.query("update inquiries set status='accepted' where id=$1",[other]);
  });
  it('does not accept a pending request whose selected start has passed',async()=>{
    await db.query("insert into inquiries(id,teacher_id,student_id,status,requested_start_at,requested_end_at) values($1,$2,$3,'sent',now()-interval '4 hours',now()-interval '3 hours')",[other,teacher,stranger]);
    await expect(db.query("update inquiries set status='accepted' where id=$1",[other])).rejects.toThrow('start has passed');
    expect((await db.query<{status:string}>('select status from inquiries where id=$1',[other])).rows[0].status).toBe('sent');
  });
});