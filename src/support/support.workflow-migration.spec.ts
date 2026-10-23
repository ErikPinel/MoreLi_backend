import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

it('backfills pending profiles, pending reports and existing appeals without changing decisions or sending retrospective mail',async()=>{
  const db=new PGlite();
  const owner='00000000-0000-0000-0000-000000000001';
  const second='00000000-0000-0000-0000-000000000002';
  const third='00000000-0000-0000-0000-000000000003';
  const admin='00000000-0000-0000-0000-000000000004';
  const migration=(name:string)=>readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create type public.notification_type as enum('inquiry_received');
      create table public.profiles(id uuid primary key,role text,first_name text,last_name text);
      create table public.teacher_profiles(id uuid primary key,user_id uuid references profiles(id),profile_status text default 'published',review_reason text);
      create table public.inquiries(id uuid primary key,teacher_id uuid references teacher_profiles(id),student_id uuid references profiles(id),status text,created_at timestamptz,responded_at timestamptz);
      create table public.reviews(id uuid primary key,teacher_id uuid references teacher_profiles(id),student_id uuid references profiles(id),status text);
      create table public.notifications(user_id uuid,type notification_type,title text,body text,entity_type text,entity_id uuid);
      create table public.email_outbox(entity_id uuid,event_type text);
      create table public.test_mail(kind text,event_key text unique);
      create function public.enqueue_marketplace_email(p_kind text,p_entity uuid,p_recipient uuid,p_audience text,p_payload jsonb,p_key text) returns void
        language sql as $$ insert into public.test_mail values(p_kind,p_key||':'||p_audience) on conflict do nothing $$;`);
    for(const id of [owner,second,third,admin])await db.query('insert into profiles values($1,$2,$2,$2)',[id,id===admin?'admin':'teacher']);
    for(const id of [owner,second,third])await db.query('insert into teacher_profiles(id,user_id,profile_status) values($1,$1,$2)',[id,id===owner?'pending':'published']);
    for(const name of ['20261021220500_activity_event_types','20261021221000_teacher_access','20261021223000_support_workflows','20261023140000_payment_reconsideration'])
      await db.exec(await migration(name));
    const claim=async(user:string)=>(await db.query<{value:{id:string}}>("select claim_teacher_access_payment($1,'EXISTING-BIT',true) as value",[user])).rows[0].value.id;
    const ticket=async(user:string)=>(await db.query<{id:string}>(`insert into support_tickets(user_id,request_key,category,subject,message,status)
      values($1,gen_random_uuid(),'billing','Existing payment question','Please reconsider the existing payment','in_progress') returning id`,[user])).rows[0].id;
    const original=await claim(owner);
    await db.query("select review_teacher_access_payment($1,$2,false,'Original saved rejection')",[admin,original]);
    const appealTicket=await ticket(owner);
    const appeal=(await db.query<{value:{id:string}}>('select reopen_teacher_access_payment($1,$2,$3) as value',[admin,original,appealTicket])).rows[0].value.id;
    const pending=await claim(second);
    const approved=await claim(third);
    await db.query("select review_teacher_access_payment($1,$2,true,'Existing approval')",[admin,approved]);
    const approvedTicket=await ticket(third);
    await db.query('update teacher_access_payments set support_ticket_id=$1 where id=$2',[approvedTicket,approved]);
    const archived=(await db.query<{value:{id:string}}>("select claim_teacher_access_payment($1,'ARCHIVED-BIT',true) as value",[third])).rows[0].value.id;
    await db.query("select review_teacher_access_payment($1,$2,true,'Already archived approval')",[admin,archived]);
    const archivedTicket=await ticket(third);
    await db.query("update support_tickets set status='resolved' where id=$1",[archivedTicket]);
    await db.query('update teacher_access_payments set support_ticket_id=$1 where id=$2',[archivedTicket,archived]);
    const before=(await db.query('select to_jsonb(payment)-\'support_ticket_id\' as value from teacher_access_payments payment order by id')).rows;
    const emails=(await db.query('select * from test_mail order by event_key')).rows;
    const notices=(await db.query('select * from notifications')).rows;
    const access=(await db.query('select * from teacher_access order by teacher_id')).rows;

    await db.exec(await migration('20261023160000_connected_support_cases'));

    expect((await db.query('select to_jsonb(payment)-\'support_ticket_id\' as value from teacher_access_payments payment order by id')).rows).toEqual(before);
    expect((await db.query('select * from teacher_access order by teacher_id')).rows).toEqual(access);
    expect((await db.query('select * from test_mail order by event_key')).rows).toEqual(emails);
    expect((await db.query('select * from notifications')).rows).toEqual(notices);
    expect((await db.query("select workflow,status from support_tickets where workflow='onboarding'")).rows).toEqual([{workflow:'onboarding',status:'open'}]);
    expect((await db.query('select payment_id,status from support_tickets where id=$1',[appealTicket])).rows).toEqual([{payment_id:appeal,status:'in_progress'}]);
    expect((await db.query('select status from support_tickets where payment_id=$1',[pending])).rows).toEqual([{status:'open'}]);
    expect((await db.query('select payment_id,status from support_tickets where id=$1',[approvedTicket])).rows).toEqual([{payment_id:approved,status:'resolved'}]);
    expect((await db.query('select workflow,payment_id,status from support_tickets where id=$1',[archivedTicket])).rows).toEqual([{workflow:'payment',payment_id:archived,status:'resolved'}]);
    expect((await db.query('select id from support_messages where ticket_id=$1',[archivedTicket])).rows).toEqual([]);
    expect((await db.query('select profile_status from teacher_profiles where id=$1',[owner])).rows).toEqual([{profile_status:'pending'}]);
  }finally{
    await db.close();
  }
},30000);
