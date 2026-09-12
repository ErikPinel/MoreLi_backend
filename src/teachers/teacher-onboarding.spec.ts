import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { TeachersController } from './teachers.controller.js';
import { TeachersService } from './teachers.service.js';

describe('Atomic teacher onboarding', () => {
  let db: PGlite;
  const student = '00000000-0000-0000-0000-000000000001';
  const form = {
    acceptTerms: true, firstName: 'Student', lastName: 'Test', phone: '0500000000',
    citySlug: 'jerusalem', avatarPath: `${student}/avatar.png`, headline: 'Tutor', bio: 'Teaching mathematics',
    hourlyPrice: 100, yearsExperience: 0, teachesOnline: true, teachesInPerson: false,
    subjectSlugs: ['math'], levelIds: [1], citySlugs: [],
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
      alter table public.teacher_profiles add column claimed_at timestamptz, add column terms_accepted_at timestamptz;
      create table public.inquiries(id uuid primary key, student_id uuid, teacher_id uuid, status text,
        requested_start_at timestamptz, requested_end_at timestamptz, lesson_mode text);`);
    await loadFunction('create_teacher_draft', await migration('20260911233000_production_lifecycle_hardening'));
    const collections = await migration('20260911230000_mvp_business_contracts');
    for (const name of ['replace_teacher_subjects', 'replace_teacher_levels', 'replace_teacher_service_areas', 'replace_teacher_availability']) await loadFunction(name, collections);
    await db.exec(await migration('20260912183000_require_tutor_contact_and_city'));
    await db.exec(await migration('20260912210000_no_payment_mvp_delivery'));
    await db.exec(await migration('20260912220000_atomic_teacher_onboarding'));
    await db.exec(`insert into subjects(id,name_he,name_en,slug) values(1,'Math','Math','math');
      insert into levels(id,name_he,name_en,slug) values(1,'School','School','school');
      insert into cities(id,name_he,name_en,slug) values(1,'Jerusalem','Jerusalem','jerusalem');`);
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('truncate profiles, auth.users, storage.objects, email_outbox cascade');
    await db.query('insert into auth.users values ($1)', [student]);
    await db.query('insert into profiles(id,contact_email) values ($1,$2)', [student, 'student@example.com']);
    await db.query('insert into storage.objects values ($1,$2)', ['teacher-avatars', form.avatarPath]);
  });
  async function submit(overrides = {}) {
    return db.query('select * from submit_teacher_onboarding($1,$2)', [student, JSON.stringify({ ...form, ...overrides })]);
  }
  async function expectStudent() {
    expect((await db.query<{ role: string }>('select role from profiles where id=$1', [student])).rows[0].role).toBe('student');
    expect((await db.query('select id from teacher_profiles')).rows).toHaveLength(0);
    expect((await db.query("select id from email_outbox where event_type like 'teacher.%'")).rows).toHaveLength(0);
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
    expect((await db.query("select id from email_outbox where event_type like 'teacher.%'")).rows).toHaveLength(jobs.length);
  });
});