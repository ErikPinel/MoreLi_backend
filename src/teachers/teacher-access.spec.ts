import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

describe('Atomic teacher contact access and manual payments', () => {
  let db: PGlite;
  const teacher='00000000-0000-0000-0000-000000000001';
  const owner='00000000-0000-0000-0000-000000000002';
  const student='00000000-0000-0000-0000-000000000003';
  const second='00000000-0000-0000-0000-000000000004';
  const admin='00000000-0000-0000-0000-000000000005';
  const inquiry='00000000-0000-0000-0000-000000000006';
  const other='00000000-0000-0000-0000-000000000007';
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create type public.notification_type as enum('inquiry_received');
      create table public.profiles(id uuid primary key,role text,first_name text,last_name text);
      create table public.teacher_profiles(id uuid primary key,user_id uuid references public.profiles(id));
      create table public.inquiries(id uuid primary key,teacher_id uuid references public.teacher_profiles(id),student_id uuid references public.profiles(id),status text,created_at timestamptz default now(),responded_at timestamptz);
      create table public.notifications(user_id uuid,type public.notification_type,title text,body text,entity_type text,entity_id uuid);
      create table public.test_mail(kind text,entity uuid,audience text,event_key text unique);
      create function public.enqueue_marketplace_email(p_kind text,p_entity uuid,p_recipient uuid,p_audience text,p_payload jsonb,p_key text) returns void language sql as $$ insert into public.test_mail values(p_kind,p_entity,p_audience,p_key||':'||p_audience) on conflict do nothing $$;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021220500_activity_event_types.sql',import.meta.url),'utf8'));
    for(const [id,role] of [[owner,'teacher'],[student,'student'],[second,'student'],[admin,'admin']])await db.query('insert into profiles values($1,$2,$2,$2)',[id,role]);
    await db.query('insert into teacher_profiles values($1,$2)',[teacher,owner]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021221000_teacher_access.sql',import.meta.url),'utf8'));
  },30000);
  afterAll(async()=>{await db.close();});
  beforeEach(async()=>{
    await db.exec('delete from teacher_access_payments;delete from teacher_contact_grants;delete from inquiries;delete from notifications;delete from test_mail;update teacher_access set free_contact_used=false,paid_until=null;');
    await db.query("insert into inquiries(id,teacher_id,student_id,status) values($1,$2,$3,'sent'),($4,$2,$5,'sent')",[inquiry,teacher,student,other,second]);
  });
  const accept=(id:string)=>db.query("update inquiries set status='accepted' where id=$1",[id]);
  const claim=async()=> (await db.query<{ value:{id:string} }>('select claim_teacher_access_payment($1,$2,true) as value',[owner,'BIT-reference-123'])).rows[0].value;

  it('allows exactly the first new contact and rolls back a blocked second acceptance',async()=>{
    await accept(inquiry);
    await expect(accept(other)).rejects.toThrow('TEACHER_ACCESS_REQUIRED');
    expect((await db.query<{status:string}>('select status from inquiries where id=$1',[other])).rows[0].status).toBe('sent');
    expect((await db.query('select * from teacher_contact_grants')).rows).toHaveLength(1);
  });
  it('does not charge for declining or repeat contact with the same accepted student',async()=>{
    await db.query("update inquiries set status='declined' where id=$1",[other]);
    await accept(inquiry);
    await db.query("update inquiries set student_id=$1,status='sent' where id=$2",[student,other]);
    await accept(other);
    expect((await db.query('select * from teacher_contact_grants')).rows).toHaveLength(1);
  });
  it('does not unlock access from a payment claim and avoids duplicate pending claims',async()=>{
    await accept(inquiry);
    const first=await claim();
    expect((await claim()).id).toBe(first.id);
    expect((await db.query('select * from teacher_access_payments')).rows).toHaveLength(1);
    expect((await db.query('select * from test_mail')).rows).toHaveLength(2);
    await expect(accept(other)).rejects.toThrow('TEACHER_ACCESS_REQUIRED');
  });
  it('requires admin confirmation and cannot extend a month twice on retry',async()=>{
    await accept(inquiry);
    const payment=await claim();
    await expect(db.query('select review_teacher_access_payment($1,$2,true,$3)',[owner,payment.id,'checked'])).rejects.toThrow('Administrator required');
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Bit receipt checked']);
    expect((await claim()).id).toBe(payment.id);
    expect((await db.query('select * from teacher_access_payments')).rows).toHaveLength(1);
    const before=(await db.query<{paid_until:string}>('select paid_until from teacher_access')).rows[0].paid_until;
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Repeated confirmation']);
    expect((await db.query<{paid_until:string}>('select paid_until from teacher_access')).rows[0].paid_until).toEqual(before);
    await accept(other);
  });
  it('expires paid access without revoking old contacts or replenishing the free allowance',async()=>{
    await accept(inquiry);
    await db.exec("update teacher_access set paid_until=now()-interval '1 day'");
    await expect(accept(other)).rejects.toThrow('TEACHER_ACCESS_REQUIRED');
    const summary=(await db.query<{value:{freeContactUsed:boolean;active:boolean}}>('select teacher_access_summary($1) as value',[owner])).rows[0].value;
    expect(summary.freeContactUsed).toBe(true);expect(summary.active).toBe(false);
    expect((await db.query('select * from teacher_contact_grants')).rows).toHaveLength(1);
  });
  it('requires agreement and a clear rejection reason, and denies browser RPC execution',async()=>{
    await expect(db.query('select claim_teacher_access_payment($1,$2,false)',[owner,'reference'])).rejects.toThrow('agreement required');
    const payment=await claim();
    await expect(db.query('select review_teacher_access_payment($1,$2,false,$3)',[admin,payment.id,''])).rejects.toThrow('clear review decision');
    const permission=await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.review_teacher_access_payment(uuid,uuid,boolean,text)','execute') as allowed");
    expect(permission.rows[0].allowed).toBe(false);
  });

  it('records rejection without revoking access, contacts, or a pending student inquiry', async () => {
    await accept(inquiry);
    await db.exec("update teacher_access set paid_until=now()+interval '10 days'");
    const before = (await db.query<{ paid_until: string }>('select paid_until from teacher_access')).rows[0].paid_until;
    const payment = await claim();
    const reason = 'The reported reference could not be matched';
    await db.query('select review_teacher_access_payment($1,$2,false,$3)', [admin, payment.id, reason]);
    const record = (await db.query<{ status: string; reviewed_by: string; review_note: string; reviewed_at: string }>('select status,reviewed_by,review_note,reviewed_at from teacher_access_payments where id=$1', [payment.id])).rows[0];
    expect(record).toMatchObject({ status: 'rejected', reviewed_by: admin, review_note: reason });
    expect(record.reviewed_at).toBeTruthy();
    expect((await db.query<{ paid_until: string }>('select paid_until from teacher_access')).rows[0].paid_until).toEqual(before);
    expect((await db.query('select * from teacher_contact_grants')).rows).toHaveLength(1);
    expect((await db.query<{ status: string }>('select status from inquiries where id=$1', [other])).rows[0].status).toBe('sent');
    const notices = await db.query<{ entity_type: string; entity_id: string; body: string }>('select entity_type,entity_id,body from notifications where entity_id=$1', [payment.id]);
    expect(notices.rows.some(row => row.entity_type === 'payment' && row.body === reason)).toBe(true);
  });
});