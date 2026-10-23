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
      create table public.teacher_profiles(id uuid primary key,user_id uuid references public.profiles(id),profile_status text default 'published',review_reason text);
      create table public.reviews(id uuid primary key,teacher_id uuid references teacher_profiles(id),student_id uuid references profiles(id),status text);
      create table public.inquiries(id uuid primary key,teacher_id uuid references public.teacher_profiles(id),student_id uuid references public.profiles(id),status text,created_at timestamptz default now(),responded_at timestamptz);
      create table public.notifications(user_id uuid,type public.notification_type,title text,body text,entity_type text,entity_id uuid);
      create table public.test_mail(kind text,entity uuid,audience text,event_key text unique);
      create table public.email_outbox(entity_id uuid,event_type text);
      create function public.enqueue_marketplace_email(p_kind text,p_entity uuid,p_recipient uuid,p_audience text,p_payload jsonb,p_key text) returns void language sql as $$ insert into public.test_mail values(p_kind,p_entity,p_audience,p_key||':'||p_audience) on conflict do nothing $$;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021220500_activity_event_types.sql',import.meta.url),'utf8'));
    for(const [id,role] of [[owner,'teacher'],[student,'student'],[second,'student'],[admin,'admin']])await db.query('insert into profiles values($1,$2,$2,$2)',[id,role]);
    await db.query('insert into teacher_profiles(id,user_id) values($1,$2)',[teacher,owner]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021221000_teacher_access.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021223000_support_workflows.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261023140000_payment_reconsideration.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261023160000_connected_support_cases.sql',import.meta.url),'utf8'));
  },30000);
  afterAll(async()=>{await db.close();});
  beforeEach(async()=>{
    await db.exec('delete from support_tickets;delete from teacher_access_payments;delete from teacher_contact_grants;delete from inquiries;delete from notifications;delete from test_mail;update teacher_access set free_contact_used=false,paid_until=null;');
    await db.query("insert into inquiries(id,teacher_id,student_id,status) values($1,$2,$3,'sent'),($4,$2,$5,'sent')",[inquiry,teacher,student,other,second]);
  });
  const accept=(id:string)=>db.query("update inquiries set status='accepted' where id=$1",[id]);
  const claim=async()=> (await db.query<{ value:{id:string;support_ticket_id:string} }>('select claim_teacher_access_payment($1,$2,true) as value',[owner,'BIT-reference-123'])).rows[0].value;
  const billingTicket=async(user=owner,category='billing')=>{
    if(user===owner&&category==='billing'){
      const existing=await db.query<{support_ticket_id:string}>('select support_ticket_id from teacher_access_payments order by created_at desc,id limit 1');
      if(existing.rows[0]?.support_ticket_id)return existing.rows[0].support_ticket_id;
    }
    return (await db.query<{id:string}>(`insert into support_tickets(user_id,request_key,category,subject,message)
      values($1,gen_random_uuid(),$2,'Please check payment','I already sent this Bit payment') returning id`,[user,category])).rows[0].id;
  };
  const reopen=async(payment:string,ticket:string,actor=admin)=>(await db.query<{value:{id:string;status:string;reconsideration_of:string;support_ticket_id:string}}>(
    'select reopen_teacher_access_payment($1,$2,$3) as value',[actor,payment,ticket])).rows[0].value;
  const reject=async(payment:string)=>db.query('select review_teacher_access_payment($1,$2,false,$3)',[admin,payment,'The transfer was not found']);

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

  it('reopens a rejection from its owner billing ticket without granting access or overwriting the decision',async()=>{
    await accept(inquiry);
    const original=await claim();
    await reject(original.id);
    const before=(await db.query('select * from teacher_access_payments where id=$1',[original.id])).rows[0];
    const ticket=await billingTicket();
    const payment=await reopen(original.id,ticket);
    expect(payment).toMatchObject({status:'pending',reconsideration_of:original.id,support_ticket_id:ticket});
    expect((await db.query('select * from teacher_access_payments where id=$1',[original.id])).rows[0]).toEqual(before);
    const copy=(await db.query('select reference,terms_accepted_at,terms_version from teacher_access_payments where id=$1',[payment.id])).rows[0];
    expect(copy).toEqual({reference:before.reference,terms_accepted_at:before.terms_accepted_at,terms_version:before.terms_version});
    await expect(accept(other)).rejects.toThrow('TEACHER_ACCESS_REQUIRED');
    expect((await db.query<{status:string}>('select status from support_tickets where id=$1',[ticket])).rows[0].status).toBe('in_progress');
    expect((await db.query('select * from support_messages where ticket_id=$1',[ticket])).rows).toHaveLength(2);
    const summary=(await db.query<{value:{payments:{id:string;reconsideration_of:string}[]}}>('select teacher_access_summary($1) as value',[owner])).rows[0].value;
    expect(summary.payments.find(row=>row.id===payment.id)?.reconsideration_of).toBe(original.id);
    expect((await claim()).id).toBe(payment.id);
  });

  it('makes reopen and approval retries idempotent, keeping both decisions in history',async()=>{
    const original=await claim();
    await reject(original.id);
    const ticket=await billingTicket();
    const payment=await reopen(original.id,ticket);
    expect((await reopen(original.id,ticket)).id).toBe(payment.id);
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Transfer verified after the appeal']);
    const until=(await db.query<{paid_until:string}>('select paid_until from teacher_access')).rows[0].paid_until;
    expect((await reopen(original.id,ticket)).id).toBe(payment.id);
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Retry']);
    expect((await db.query<{paid_until:string}>('select paid_until from teacher_access')).rows[0].paid_until).toEqual(until);
    expect((await db.query('select * from teacher_access_payments')).rows).toHaveLength(2);
    expect((await db.query('select * from support_messages')).rows).toHaveLength(3);
    expect((await db.query<{status:string}>('select status from teacher_access_payments where id=$1',[original.id])).rows[0].status).toBe('rejected');
  });

  it('allows a new explained rejection and a subsequent appeal without losing prior decisions',async()=>{
    const original=await claim();
    await reject(original.id);
    const ticket=await billingTicket();
    const payment=await reopen(original.id,ticket);
    await expect(db.query('select review_teacher_access_payment($1,$2,false,$3)',[admin,payment.id,''])).rejects.toThrow('clear review decision');
    await reject(payment.id);
    expect((await reopen(payment.id,ticket)).reconsideration_of).toBe(payment.id);
    expect((await db.query("select * from teacher_access_payments where status='rejected'")).rows).toHaveLength(2);
    expect((await db.query<{paid_until:string|null}>('select paid_until from teacher_access')).rows[0].paid_until).toBeNull();
  });

  it('requires an admin and a billing ticket authored by the payment owner, not its reported teacher',async()=>{
    const original=await claim();
    await reject(original.id);
    const ticket=await billingTicket();
    await expect(reopen(original.id,ticket,owner)).rejects.toThrow('Administrator required');
    const strangerTicket=await billingTicket(student);
    await db.query('update support_tickets set teacher_id=$1 where id=$2',[teacher,strangerTicket]);
    await expect(reopen(original.id,strangerTicket)).rejects.toThrow('payment owner');
    await expect(reopen(original.id,await billingTicket(owner,'bug'))).rejects.toThrow('billing ticket');
    expect((await db.query('select * from teacher_access_payments')).rows).toHaveLength(1);
    for(const role of ['anon','authenticated']){
      expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.reopen_teacher_access_payment(uuid,uuid,uuid)','execute') as allowed",[role])).rows[0].allowed).toBe(false);
    }
  });

  it('refuses pending or approved payments and a second pending report, with no partial reopening',async()=>{
    const original=await claim();
    const ticket=await billingTicket();
    await expect(reopen(original.id,ticket)).rejects.toThrow('Only a rejected payment');
    await reject(original.id);
    const secondPayment=(await db.query<{value:{id:string}}>('select claim_teacher_access_payment($1,$2,true) as value',[owner,'BIT-another-transfer'])).rows[0].value;
    await expect(reopen(original.id,ticket)).rejects.toThrow('existing pending payment');
    expect((await db.query('select * from support_messages')).rows).toHaveLength(1);
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,secondPayment.id,'Verified']);
    await expect(reopen(secondPayment.id,ticket)).rejects.toThrow('Only a rejected payment');
  });

  it('creates one owned case with the report and closes only that case on approval',async()=>{
    const payment=await claim();
    expect(payment.support_ticket_id).toBeTruthy();
    expect((await claim()).support_ticket_id).toBe(payment.support_ticket_id);
    const unrelated=await billingTicket(owner,'support');
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Bit receipt verified']);
    expect((await db.query('select user_id,workflow,status,payment_id from support_tickets where id=$1',[payment.support_ticket_id])).rows[0])
      .toEqual({user_id:owner,workflow:'payment',status:'resolved',payment_id:payment.id});
    expect((await db.query('select status from support_tickets where id=$1',[unrelated])).rows[0]).toEqual({status:'open'});
    expect((await db.query('select author_role from support_messages where ticket_id=$1',[payment.support_ticket_id])).rows).toEqual([{author_role:'system'}]);
    await db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Retry']);
    expect((await db.query('select id from support_messages where ticket_id=$1',[payment.support_ticket_id])).rows).toHaveLength(1);
  });

  it('waits for the customer after rejection, then reopens the same case on their reply',async()=>{
    const payment=await claim();
    await reject(payment.id);
    expect((await db.query('select status from support_tickets where id=$1',[payment.support_ticket_id])).rows[0]).toEqual({status:'waiting_customer'});
    expect((await db.query<{body:string}>('select body from support_messages where ticket_id=$1',[payment.support_ticket_id])).rows[0].body).toContain('The transfer was not found');
    await db.query('select reply_support_ticket($1,$2,$3)',[owner,payment.support_ticket_id,'Here is the additional transfer information']);
    expect((await db.query('select status from support_tickets where id=$1',[payment.support_ticket_id])).rows[0]).toEqual({status:'open'});
    expect((await db.query('select status from teacher_access_payments where id=$1',[payment.id])).rows[0]).toEqual({status:'rejected'});
    await db.query('select reply_support_ticket($1,$2,$3,$4)',[admin,payment.support_ticket_id,'The support conversation is now closed','resolved']);
    expect((await db.query('select paid_until from teacher_access')).rows[0]).toEqual({paid_until:null});
  });

  it('rolls back access and payment approval if saving the case decision fails',async()=>{
    const payment=await claim();
    await db.exec("alter table support_messages add constraint test_reject_automatic_message check(author_role<>'system')");
    try{
      await expect(db.query('select review_teacher_access_payment($1,$2,true,$3)',[admin,payment.id,'Verified'])).rejects.toThrow('test_reject_automatic_message');
      expect((await db.query('select status from teacher_access_payments where id=$1',[payment.id])).rows[0]).toEqual({status:'pending'});
      expect((await db.query('select paid_until from teacher_access')).rows[0]).toEqual({paid_until:null});
      expect((await db.query('select status from support_tickets where id=$1',[payment.support_ticket_id])).rows[0]).toEqual({status:'open'});
    }finally{
      await db.exec('alter table support_messages drop constraint test_reject_automatic_message');
    }
  });

  it('does not let another conversation take over an existing payment appeal',async()=>{
    const original=await claim();
    await reject(original.id);
    const separate=(await db.query<{id:string}>(`insert into support_tickets(user_id,request_key,category,subject,message)
      values($1,gen_random_uuid(),'billing','Another billing question','Please check this separate conversation') returning id`,[owner])).rows[0].id;
    await expect(reopen(original.id,separate)).rejects.toThrow('linked billing case');
    expect((await db.query('select id from teacher_access_payments')).rows).toHaveLength(1);
    expect((await db.query('select status from support_tickets where id=$1',[separate])).rows[0]).toEqual({status:'open'});
  });
});