import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

describe('Owned support and moderation workflows',()=>{
  let db:PGlite;
  const owner='00000000-0000-0000-0000-000000000001';
  const admin='00000000-0000-0000-0000-000000000002';
  const stranger='00000000-0000-0000-0000-000000000003';
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table public.profiles(id uuid primary key,role text,first_name text,last_name text);
      create table public.teacher_profiles(id uuid primary key,user_id uuid);
      create table public.inquiries(id uuid primary key,student_id uuid,teacher_id uuid);
      create table public.notifications(user_id uuid,type text,title text,body text,entity_type text,entity_id uuid);
      create table public.email_outbox(entity_id uuid,event_type text);
      create table public.test_mail(kind text,key text unique);
      create function public.enqueue_marketplace_email(p_kind text,p_entity uuid,p_recipient uuid,p_audience text,p_payload jsonb,p_key text) returns void language sql as $$ insert into public.test_mail values(p_kind,p_key||':'||p_audience) on conflict do nothing $$;`);
    for(const [id,role] of [[owner,'student'],[admin,'admin'],[stranger,'student']])await db.query('insert into profiles values($1,$2,$2,$2)',[id,role]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021223000_support_workflows.sql',import.meta.url),'utf8'));
  },30000);
  afterAll(async()=>{await db.close();});
  beforeEach(async()=>{await db.exec('delete from support_tickets;delete from notifications;delete from test_mail;');});
  const create=async(key='00000000-0000-0000-0000-000000000010')=>(await db.query<{value:{id:string}}>("select create_support_ticket($1,$2,'bug','A clear issue','Enough detail for support to help',null,null) as value",[owner,key])).rows[0].value;
  it('creates an owner-scoped idempotent ticket and queues one confirmation per audience',async()=>{
    const first=await create();expect((await create()).id).toBe(first.id);
    expect((await db.query('select * from support_tickets')).rows).toHaveLength(1);
    expect((await db.query('select * from test_mail')).rows).toHaveLength(2);
  });
  it('rejects a stranger and prevents the ticket owner from assigning admin status',async()=>{
    const ticket=await create();
    await expect(db.query('select reply_support_ticket($1,$2,$3,null)',[stranger,ticket.id,'Not my ticket'])).rejects.toThrow('not found');
    await expect(db.query("select reply_support_ticket($1,$2,$3,'resolved')",[owner,ticket.id,'Self approval'])).rejects.toThrow('Administrator required');
  });
  it('stores the conversation, admin resolution and notifications without trusting client roles',async()=>{
    const ticket=await create();
    await db.query("select reply_support_ticket($1,$2,$3,'resolved')",[admin,ticket.id,'We corrected the reported problem']);
    expect((await db.query<{status:string}>('select status from support_tickets')).rows[0].status).toBe('resolved');
    await db.query('select reply_support_ticket($1,$2,$3,null)',[owner,ticket.id,'I still see the issue']);
    expect((await db.query<{status:string}>('select status from support_tickets')).rows[0].status).toBe('open');
    expect((await db.query('select * from support_messages')).rows).toHaveLength(2);
  });
  it('bounds ticket creation and denies browser RPC access',async()=>{
    for(let index=10;index<15;index++)await create(`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`);
    await expect(create('00000000-0000-0000-0000-000000000015')).rejects.toThrow('limit reached');
    expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.reply_support_ticket(uuid,uuid,text,text)','execute') as allowed")).rows[0].allowed).toBe(false);
  });
});