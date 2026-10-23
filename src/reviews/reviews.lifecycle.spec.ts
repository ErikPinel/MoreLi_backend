import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

describe('Review management database contracts', () => {
  let db: PGlite;
  const student = '00000000-0000-0000-0000-000000000001';
  const teacherUser = '00000000-0000-0000-0000-000000000002';
  const admin = '00000000-0000-0000-0000-000000000003';
  const stranger = '00000000-0000-0000-0000-000000000004';
  const teacher = '00000000-0000-0000-0000-000000000005';
  const review = '00000000-0000-0000-0000-000000000006';

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create type public.review_status as enum ('pending','published','rejected');
      create table public.profiles(id uuid primary key, role text);
      create table public.teacher_profiles(id uuid primary key, user_id uuid, profile_status text default 'published', average_rating numeric default 0, review_count integer default 0);
      create table public.reviews(id uuid primary key default gen_random_uuid(), student_id uuid references profiles(id), teacher_id uuid references teacher_profiles(id),
        inquiry_id uuid, rating smallint not null check(rating between 1 and 5), body text, unique(student_id,teacher_id),
        status public.review_status, created_at timestamptz default now(), updated_at timestamptz default now());
      create table public.notifications(id uuid default gen_random_uuid(), user_id uuid, type text, title text, body text, entity_type text, entity_id uuid);`);
    const contracts = await readFile(new URL('../../supabase/migrations/20260911230000_mvp_business_contracts.sql', import.meta.url), 'utf8');
    await db.exec(contracts.slice(contracts.indexOf('create function public.refresh_teacher_review_aggregates()'), contracts.indexOf('create function public.submit_verified_review(')));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021190000_review_management.sql', import.meta.url), 'utf8'));
    await db.exec(`create function public.guard_review_completed_lesson() returns trigger language plpgsql as $$
      begin raise exception 'A completed lesson was required'; end; $$;
      create trigger reviews_require_completed_lesson before insert on public.reviews for each row execute function public.guard_review_completed_lesson();`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261023190000_open_student_ratings.sql', import.meta.url), 'utf8'));
    for (const [id, role] of [[student, 'student'], [teacherUser, 'teacher'], [admin, 'admin'], [stranger, 'student']]) {
      await db.query('insert into profiles values ($1,$2)', [id, role]);
    }
    await db.query('insert into teacher_profiles(id,user_id) values ($1,$2)', [teacher, teacherUser]);
  }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('delete from reviews; delete from notifications;');
    await db.query("update teacher_profiles set profile_status='published' where id=$1", [teacher]);
    await db.query("insert into reviews(id,student_id,teacher_id,rating,body,status) values ($1,$2,$3,5,'A helpful lesson','published')", [review, student, teacher]);
  });

  const aggregate = async () => (await db.query<{ average_rating: string; review_count: number }>('select average_rating,review_count from teacher_profiles where id=$1', [teacher])).rows[0];

  it.each([1, 2, 3, 4, 5])('publishes rating %i without a comment, inquiry or lesson and refreshes aggregates', async (rating) => {
    const result = await db.query<{ rating: number; body: string | null; inquiry_id: string | null; status: string }>(
      'select * from submit_teacher_review($1,$2,$3::smallint,null)', [stranger, teacher, rating]);
    expect(result.rows[0]).toMatchObject({ rating, body: null, inquiry_id: null, status: 'published' });
    expect(Number((await aggregate()).average_rating)).toBe((5 + rating) / 2);
    expect((await aggregate()).review_count).toBe(2);
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
  });

  it('normalizes an empty/whitespace comment and preserves an optional written comment', async () => {
    const blank = await db.query<{ body: string | null }>("select * from submit_teacher_review($1,$2,4::smallint,'   ')", [stranger, teacher]);
    expect(blank.rows[0].body).toBeNull();
    await db.query('delete from reviews where student_id=$1', [stranger]);
    const written = await db.query<{ body: string }>("select * from submit_teacher_review($1,$2,4::smallint,'  Helpful teacher  ')", [stranger, teacher]);
    expect(written.rows[0].body).toBe('Helpful teacher');
  });

  it('requires a rating and rejects values outside 1–5 or oversized comments', async () => {
    for (const rating of [null, 0, 6]) {
      await expect(db.query('select * from submit_teacher_review($1,$2,$3::smallint,null)', [stranger, teacher, rating])).rejects.toThrow('Rating must');
    }
    await expect(db.query('select * from submit_teacher_review($1,$2,5::smallint,$3)', [stranger, teacher, 'x'.repeat(3001)])).rejects.toThrow('Invalid review content');
  });

  it('prevents self-ratings, nonstudent authors, unpublished teachers and duplicate ratings', async () => {
    await expect(db.query('select * from submit_teacher_review($1,$2,5::smallint,null)', [teacherUser, teacher])).rejects.toThrow('other than yourself');
    await expect(db.query('select * from submit_teacher_review($1,$2,5::smallint,null)', [admin, teacher])).rejects.toThrow('Student account required');
    await expect(db.query('select * from submit_teacher_review($1,$2,5::smallint,null)', [student, teacher])).rejects.toThrow('unique');
    await db.query("update teacher_profiles set profile_status='pending' where id=$1", [teacher]);
    await expect(db.query('select * from submit_teacher_review($1,$2,5::smallint,null)', [stranger, teacher])).rejects.toThrow('published teacher');
    expect((await db.query('select * from notifications')).rows).toHaveLength(0);
  });

  it('allows a teacher account to rate another teacher in its student capacity', async () => {
    await db.query("update profiles set role='teacher' where id=$1", [stranger]);
    const result = await db.query<{ rating: number }>('select * from submit_teacher_review($1,$2,3::smallint,null)', [stranger, teacher]);
    expect(result.rows[0].rating).toBe(3);
    await db.query("update profiles set role='student' where id=$1", [stranger]);
  });

  it('requires author ownership for edits and deletion', async () => {
    await expect(db.query('select * from edit_owned_review($1,$2,3::smallint,$3)', [review, stranger, 'Edited'])).rejects.toThrow('Review not found');
    await expect(db.query('select delete_owned_review($1,$2)', [review, stranger])).rejects.toThrow('Review not found');
    expect((await aggregate()).review_count).toBe(1);
  });

  it('returns edits to moderation, removes stale replies, and refreshes published aggregates', async () => {
    await db.query('select * from reply_to_review($1,$2,$3)', [review, teacherUser, 'Thank you for learning with me']);
    const edited = await db.query<{ status: string; teacher_reply: string | null }>('select * from edit_owned_review($1,$2,3::smallint,$3)', [review, student, 'Updated after another lesson']);
    expect(edited.rows[0].status).toBe('pending');
    expect(edited.rows[0].teacher_reply).toBeNull();
    expect((await aggregate()).review_count).toBe(0);
    await db.query("update reviews set status='published' where id=$1", [review]);
    expect(Number((await aggregate()).average_rating)).toBe(3);
    await db.query('select delete_owned_review($1,$2)', [review, student]);
    expect((await aggregate()).review_count).toBe(0);
  });

  it('does not let an author edit rejected content straight back into publication', async () => {
    await db.query("update reviews set status='rejected' where id=$1", [review]);
    const edited = await db.query<{ status: string }>('select * from edit_owned_review($1,$2,4::smallint,$3)', [review, student, 'Revised review']);
    expect(edited.rows[0].status).toBe('pending');
  });

  it('only permits the reviewed teacher to reply, enforces length, and holds replies for approval', async () => {
    await expect(db.query('select * from reply_to_review($1,$2,$3)', [review, stranger, 'Not my review'])).rejects.toThrow('Review not found');
    await expect(db.query('select * from reply_to_review($1,$2,$3)', [review, teacherUser, '   '])).rejects.toThrow('5 to 2000');
    const result = await db.query<{ teacher_reply_status: string }>('select * from reply_to_review($1,$2,$3)', [review, teacherUser, 'Thank you for your feedback']);
    expect(result.rows[0].teacher_reply_status).toBe('pending');
    expect((await aggregate()).review_count).toBe(1);
    await db.query('select * from reply_to_review($1,$2,null)', [review, teacherUser]);
    expect((await db.query<{ teacher_reply: string | null }>('select teacher_reply from reviews')).rows[0].teacher_reply).toBeNull();
  });

  it('restricts reply moderation to admins and notifies the author once on publication', async () => {
    await db.query('select * from reply_to_review($1,$2,$3)', [review, teacherUser, 'Thank you for your feedback']);
    await expect(db.query("select * from moderate_review_reply($1,$2,'published')", [review, teacherUser])).rejects.toThrow('Administrator required');
    await db.query("select * from moderate_review_reply($1,$2,'published')", [review, admin]);
    await db.query("select * from moderate_review_reply($1,$2,'published')", [review, admin]);
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
    await db.query('select * from reply_to_review($1,$2,$3)', [review, teacherUser, 'A revised reply goes back for review']);
    expect((await db.query<{ teacher_reply_status: string }>('select teacher_reply_status from reviews')).rows[0].teacher_reply_status).toBe('pending');
  });

  it('denies browser execution of mutation functions', async () => {
    const result = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.reply_to_review(uuid,uuid,text)','execute') as allowed");
    expect(result.rows[0].allowed).toBe(false);
    const rating = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.submit_teacher_review(uuid,uuid,smallint,text)','execute') as allowed");
    expect(rating.rows[0].allowed).toBe(false);
    await expect(db.query('select * from edit_owned_review($1,$2,0::smallint,$3)', [review, student, 'Invalid rating'])).rejects.toThrow('Invalid review');
  });
});