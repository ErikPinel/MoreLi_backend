import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { TeachersController } from './teachers.controller.js';
import { TeachersService } from './teachers.service.js';

describe('Atomic teacher onboarding', () => {
  let db: PGlite;
  const student = '00000000-0000-0000-0000-000000000001';
  const admin = '00000000-0000-0000-0000-000000000002';
  const form = {
    acceptTerms: true, firstName: 'Student', lastName: 'Test', phone: '0500000000',
    citySlug: 'jerusalem', avatarPath: `${student}/avatar.png`, headline: 'Tutor', bio: 'Teaching mathematics',
    hourlyPrice: 100, yearsExperience: 0, teachesOnline: true, teachesInPerson: false,
    subjectSlugs: ['math'], citySlugs: [],
    slots: [{ dayOfWeek: 0, startTime: '16:00', endTime: '18:00' }],
  };
  const migration = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  async function loadFunction(name: string, source: string) {
    const start = source.indexOf(`create function public.${name}(`);
    if (start < 0) throw new Error(`Missing SQL function ${name}`);
    await db.exec(source.slice(start, source.indexOf('$$;', start) + 3));
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create schema storage; create table storage.objects(bucket_id text, name text);`);
    const initial = await migration('202609110001_initial_schema');
    await db.exec(initial.slice(0, initial.indexOf('create table public.student_requests')) + 'commit;');
    await db.exec(`alter table public.profiles add column contact_email text, add column city_id bigint;
      create type public.notification_type as enum('teacher_verified');
      create table public.notifications(user_id uuid,type public.notification_type,title text,body text,entity_type text,entity_id uuid);
      alter table public.teacher_profiles add column claimed_at timestamptz, add column terms_accepted_at timestamptz;
      create table public.inquiries(id uuid primary key, student_id uuid, teacher_id uuid, status text,
        requested_start_at timestamptz, requested_end_at timestamptz, lesson_mode text,created_at timestamptz default now(),responded_at timestamptz);
      create table public.reviews(id uuid primary key default gen_random_uuid(),teacher_id uuid references teacher_profiles(id),
        student_id uuid references profiles(id),status text default 'published',body text);`);
    await loadFunction('create_teacher_draft', await migration('20260911233000_production_lifecycle_hardening'));
    const collections = await migration('20260911230000_mvp_business_contracts');
    for (const name of ['replace_teacher_subjects', 'replace_teacher_levels', 'replace_teacher_service_areas', 'replace_teacher_availability']) await loadFunction(name, collections);
    await db.exec(await migration('20260912183000_require_tutor_contact_and_city'));
    await db.exec(await migration('20260912210000_no_payment_mvp_delivery'));
    await db.exec(await migration('20260912220000_atomic_teacher_onboarding'));
    await db.exec('alter table public.teacher_profiles add column availability_customized boolean not null default false');
    await db.exec(await migration('20261022190000_atomic_teacher_profile'));
    await db.exec(await migration('20261023111000_retire_teacher_levels'));
    await loadFunction('approve_teacher_review', await migration('20260912180000_email_review_and_lesson_requests'));
    await db.exec(await migration('20261021220500_activity_event_types'));
    await db.exec(await migration('20261021221000_teacher_access'));
    await db.exec(await migration('20261021223000_support_workflows'));
    await db.exec(await migration('20261023140000_payment_reconsideration'));
    await db.exec(await migration('20261023160000_connected_support_cases'));
    await db.exec(`create constraint trigger test_published_teacher_integrity
      after insert or update on public.teacher_profiles deferrable initially deferred
      for each row execute function public.assert_published_teacher_integrity();`);
    await db.exec(`insert into subjects(id,name_he,name_en,slug) values(1,'Math','Math','math');
      insert into levels(id,name_he,name_en,slug) values(1,'School','School','school');
      insert into cities(id,name_he,name_en,slug) values(1,'Jerusalem','Jerusalem','jerusalem');`);
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('truncate profiles, auth.users, storage.objects, email_outbox, notifications cascade');
    await db.query('insert into auth.users values ($1)', [student]);
    await db.query('insert into profiles(id,contact_email) values ($1,$2)', [student, 'student@example.com']);
    await db.query('insert into storage.objects values ($1,$2)', ['teacher-avatars', form.avatarPath]);
  });
  async function submit(overrides = {}) {
    return db.query('select * from submit_teacher_onboarding($1,$2)', [student, JSON.stringify({ ...form, ...overrides })]);
  }
  async function createAdmin() {
    await db.query('insert into auth.users values($1)',[admin]);
    await db.query("insert into profiles(id,role,contact_email) values($1,'admin','admin@example.com')",[admin]);
  }
  async function expectStudent() {
    expect((await db.query<{ role: string }>('select role from profiles where id=$1', [student])).rows[0].role).toBe('student');
    expect((await db.query('select id from teacher_profiles')).rows).toHaveLength(0);
    expect((await db.query("select id from email_outbox where event_type like 'teacher.%'")).rows).toHaveLength(0);
    expect((await db.query('select id from support_tickets')).rows).toHaveLength(0);
  }
  it('rejects the legacy empty-account endpoint', () => {
    expect(() => new TeachersController({} as TeachersService).createDraft()).toThrow('יש למלא');
  });
  it('does not create a teacher merely by starting setup', async () => { await expectStudent(); });
  it('rolls back role, profile and outbox when a catalog choice is invalid', async () => {
    await expect(submit({ subjectSlugs: ['missing'] })).rejects.toThrow();
    await expectStudent();
  });
  it('rolls back on invalid hours and requires availability even for online teaching', async () => {
    await expect(submit({ slots: [{ dayOfWeek: 0, startTime: '16:00', endTime: '06:00' }] })).rejects.toThrow();
    await expectStudent();
    await expect(submit({ slots: [] })).rejects.toThrow();
    await expectStudent();
  });
  it('requires explicit consent, experience and an owned uploaded avatar', async () => {
    for (const overrides of [{ acceptTerms: false }, { yearsExperience: null }, { avatarPath: 'someone-else/avatar.png' }]) {
      await expect(submit(overrides)).rejects.toThrow();
      await expectStudent();
    }
  });
  it('rejects overlapping weekly windows without converting the account', async () => {
    await expect(submit({ slots: [...form.slots, { dayOfWeek: 0, startTime: '17:00', endTime: '19:00' }] })).rejects.toThrow('overlap');
    await expectStudent();
  });
  it('does not convert students without verified contact email', async () => {
    await db.query('update profiles set contact_email=null where id=$1', [student]);
    await expect(submit()).rejects.toThrow();
    await expectStudent();
  });
  it('creates one pending teacher and safely retries without duplicate jobs', async () => {
    const result = await submit();
    expect(result.rows[0]).toMatchObject({ profile_status: 'pending', teaches_online: true, years_experience: 0 });
    expect((await db.query<{ role: string }>('select role from profiles where id=$1', [student])).rows[0].role).toBe('teacher');
    const jobs = (await db.query("select id from email_outbox where event_type like 'teacher.%'")).rows;
    expect(jobs.length).toBeGreaterThan(0);
    await submit();
    expect((await db.query('select id from teacher_profiles')).rows).toHaveLength(1);
    expect((await db.query("select workflow,status from support_tickets")).rows).toEqual([{ workflow: 'onboarding', status: 'open' }]);
    expect((await db.query("select id from email_outbox where event_type like 'teacher.%'")).rows).toHaveLength(jobs.length);
  });

  it('atomically saves all existing teacher sections without changing publication status', async () => {
    await submit();
    const updated = { ...form, firstName: 'Updated', headline: 'Updated teacher', hourlyPrice: 150, slots: [{ dayOfWeek: 2, startTime: '10:00', endTime: '12:00' }] };
    const result = await db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify(updated)]);
    expect(result.rows[0]).toMatchObject({ headline: 'Updated teacher', hourly_price: 150, profile_status: 'pending', availability_customized: true });
    expect((await db.query('select first_name from profiles where id=$1', [student])).rows[0]).toMatchObject({ first_name: 'Updated' });
    expect((await db.query('select day_of_week from teacher_availability')).rows).toEqual([{ day_of_week: 2 }]);
  });

  it('rolls back identity, price and collections when any section is invalid', async () => {
    await submit();
    await expect(db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify({ ...form, firstName: 'Must roll back', hourlyPrice: 200, subjectSlugs: ['missing'] })])).rejects.toThrow();
    expect((await db.query('select first_name from profiles where id=$1', [student])).rows[0]).toMatchObject({ first_name: form.firstName });
    expect((await db.query('select hourly_price from teacher_profiles')).rows[0]).toMatchObject({ hourly_price: 100 });
    expect((await db.query('select level_id from teacher_levels')).rows).toEqual([]);
  });

  it('rejects non-teacher accounts, unowned avatars and invalid availability', async () => {
    await expect(db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify(form)])).rejects.toThrow('Teacher account');
    await submit();
    for (const overrides of [{ avatarPath: 'other/avatar.png' }, { slots: [{ dayOfWeek: 0, startTime: '16:00', endTime: '18:00', timezone: 'UTC' }] }, { slots: [...form.slots, { dayOfWeek: 0, startTime: '17:00', endTime: '19:00' }] }]) {
      await expect(db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify({ ...form, ...overrides })])).rejects.toThrow();
    }
  });

  it('saves an incomplete private draft but does not allow it to be submitted for review', async () => {
    await submit();
    await db.query("update teacher_profiles set profile_status='draft' where user_id=$1", [student]);
    const incomplete = { ...form, headline: '', bio: '', hourlyPrice: 0, subjectSlugs: [], slots: [] };
    const result = await db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify(incomplete)]);
    expect(result.rows[0]).toMatchObject({ profile_status: 'draft', headline: '', hourly_price: 0 });
    await expect(db.query('select * from save_teacher_profile($1,$2,true)', [student, JSON.stringify(incomplete)])).rejects.toThrow();
    expect((await db.query('select profile_status from teacher_profiles')).rows[0]).toMatchObject({ profile_status: 'draft' });
  });

  it('submits, publishes and edits a complete teacher without any levels', async () => {
    await submit();
    expect((await db.query('select * from teacher_levels')).rows).toEqual([]);
    await db.query("update teacher_profiles set profile_status='published' where user_id=$1", [student]);
    const saved = await db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify({ ...form, headline: 'No level needed' })]);
    expect(saved.rows[0]).toMatchObject({ profile_status: 'published', headline: 'No level needed' });
    await expect(db.query("update teacher_profiles set headline='' where user_id=$1", [student])).rejects.toThrow('incomplete');
  });

  it('preserves historical levels when saving a profile without a level field', async () => {
    await submit();
    await db.exec('insert into teacher_levels(teacher_id, level_id) select id, 1 from teacher_profiles');
    await db.query('select * from save_teacher_profile($1,$2,false)', [student, JSON.stringify(form)]);
    expect((await db.query('select level_id from teacher_levels')).rows).toEqual([{ level_id: 1 }]);
  });

  it('keeps one case through correction, customer reply, resubmission and admin approval',async()=>{
    await createAdmin();
    await submit();
    const teacher=(await db.query<{id:string}>('select id from teacher_profiles')).rows[0].id;
    const ticket=(await db.query<{id:string}>('select id from support_tickets')).rows[0].id;
    await db.query('select reject_teacher_review($1,$2,$3)',[teacher,admin,'Please add details about your teaching experience']);
    expect((await db.query('select status from support_tickets where id=$1',[ticket])).rows[0]).toEqual({status:'waiting_customer'});
    expect((await db.query<{body:string}>("select body from support_messages where ticket_id=$1 and body like '%Please add%'",[ticket])).rows).toHaveLength(1);
    await db.query('select reply_support_ticket($1,$2,$3)',[student,ticket,'I will update the profile details today']);
    expect((await db.query('select status from support_tickets where id=$1',[ticket])).rows[0]).toEqual({status:'open'});
    expect((await db.query('select profile_status from teacher_profiles')).rows[0]).toEqual({profile_status:'draft'});
    await db.query('select save_teacher_profile($1,$2,true)',[student,JSON.stringify(form)]);
    expect((await db.query('select id,status from support_tickets')).rows).toEqual([{id:ticket,status:'open'}]);
    await db.query('select approve_teacher_review_by_admin($1,$2)',[teacher,admin]);
    expect((await db.query('select id,status from support_tickets')).rows).toEqual([{id:ticket,status:'resolved'}]);
    expect((await db.query('select profile_status from teacher_profiles')).rows[0]).toEqual({profile_status:'published'});
    const decisions=await db.query("select author_id from support_messages where ticket_id=$1 and body like '%אושר ופורסם%'",[ticket]);
    expect(decisions.rows).toEqual([{author_id:admin}]);
  });

  it('does not publish a teacher by manually closing their case',async()=>{
    await createAdmin();
    await submit();
    const ticket=(await db.query<{id:string}>('select id from support_tickets')).rows[0].id;
    await db.query('select reply_support_ticket($1,$2,$3,$4)',[admin,ticket,'Closing this conversation without a publication decision','resolved']);
    expect((await db.query('select profile_status from teacher_profiles')).rows[0]).toEqual({profile_status:'pending'});
    await db.query('select reply_support_ticket($1,$2,$3)',[student,ticket,'Please continue reviewing my profile']);
    expect((await db.query('select id,status from support_tickets')).rows).toEqual([{id:ticket,status:'open'}]);
  });

  it('rolls back case closure when publication fails integrity checks and covers the email approval path',async()=>{
    await createAdmin();
    await submit();
    const teacher=(await db.query<{id:string}>('select id from teacher_profiles')).rows[0].id;
    const before=(await db.query('select * from support_messages')).rows;
    await db.query("update teacher_profiles set headline='' where id=$1",[teacher]);
    await expect(db.query('select approve_teacher_review_by_admin($1,$2)',[teacher,admin])).rejects.toThrow('incomplete');
    expect((await db.query('select status from support_tickets')).rows).toEqual([{status:'open'}]);
    expect((await db.query('select * from support_messages')).rows).toEqual(before);
    await db.query("update teacher_profiles set headline='Restored teacher headline' where id=$1",[teacher]);
    await db.query('select approve_teacher_review($1)',[teacher]);
    expect((await db.query('select status from support_tickets')).rows).toEqual([{status:'resolved'}]);
  });

  it('links reported content only when visible to the requester, without generating cases for ordinary reviews',async()=>{
    await createAdmin();
    await submit();
    const teacher=(await db.query<{id:string}>('select id from teacher_profiles')).rows[0].id;
    const review=(await db.query<{id:string}>("insert into reviews(teacher_id,student_id,status,body) values($1,$2,'pending','A review awaiting moderation') returning id",[teacher,student])).rows[0].id;
    expect((await db.query('select id from support_tickets')).rows).toHaveLength(1);
    await expect(db.query('select create_context_support_ticket($1,gen_random_uuid(),$2,$3,$4,null,null,$5)',[admin,'report','Reported review','Please investigate the reported review',review])).rejects.toThrow('Reported review not found');
    expect((await db.query('select id from support_tickets')).rows).toHaveLength(1);
    const key='00000000-0000-0000-0000-000000000010';
    const args=[student,key,'report','Reported review','Please investigate the reported review',review];
    const report=await db.query<{value:{id:string;review_id:string;teacher_id:string}}>('select create_context_support_ticket($1,$2,$3,$4,$5,null,null,$6) as value',args);
    expect(report.rows[0].value).toMatchObject({review_id:review,teacher_id:teacher});
    await db.query('select create_context_support_ticket($1,$2,$3,$4,$5,null,null,$6)',args);
    expect((await db.query('select id from support_tickets')).rows).toHaveLength(2);
    await db.query('delete from reviews where id=$1',[review]);
    expect((await db.query('select review_id from support_tickets where id=$1',[report.rows[0].value.id])).rows).toEqual([{review_id:review}]);
    for(const role of ['anon','authenticated']){
      expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.create_context_support_ticket(uuid,uuid,text,text,text,uuid,uuid,uuid)','execute') as allowed",[role])).rows[0].allowed).toBe(false);
      expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.record_case_decision(uuid,uuid,text,text)','execute') as allowed",[role])).rows[0].allowed).toBe(false);
    }
  });

  it('keeps the manual support quota separate from automatically opened cases',async()=>{
    await submit();
    await db.query("select claim_teacher_access_payment($1,'BIT-QUOTA-TEST',true)",[student]);
    for(let index=10;index<15;index++){
      await db.query("select create_support_ticket($1,$2,'support','A support question','This is a separate manual support question')",[student,`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`]);
    }
    await expect(db.query("select create_support_ticket($1,gen_random_uuid(),'support','Another support question','This should exceed the manual daily quota')",[student])).rejects.toThrow('limit reached');
    expect((await db.query('select id from support_tickets')).rows).toHaveLength(7);
  });
});