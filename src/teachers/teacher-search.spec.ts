import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

type CatalogItem = { name_he: string; slug: string };
const catalog: CatalogItem[] = JSON.parse(await readFile(new URL('../../../client/src/data/professions.json', import.meta.url), 'utf8'));
const families = catalog.filter(item => item.name_he.endsWith(' - הכל'));
const migration = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');

describe('Teacher search database contracts', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);`);
    const initial = await migration('202609110001_initial_schema');
    await db.exec(initial.slice(0, initial.indexOf('create index')) + 'commit;');
    await db.exec(await migration('20260912143000_teacher_search_v2'));
    await db.exec(await migration('20261023110000_subject_category_search'));
    await db.query(`insert into subjects(name_he,name_en,slug)
      select name_he,name_he,slug from jsonb_to_recordset($1::jsonb) as item(name_he text,slug text)`, [JSON.stringify(catalog)]);
    await db.exec(`insert into auth.users select md5(slug)::uuid from subjects;
      insert into profiles(id) select id from auth.users;
      insert into teacher_profiles(id,user_id,slug,hourly_price,teaches_online,teaches_in_person,profile_status,published_at)
        select md5(slug)::uuid,md5(slug)::uuid,slug,100,true,true,'published','2026-10-01'::timestamptz from subjects;
      insert into teacher_subjects(teacher_id,subject_id) select md5(slug)::uuid,id from subjects;
      insert into cities(id,name_he,name_en,slug) values (1,'פתח תקווה','Petah Tikva','petah-tikva'),(2,'חיפה','Haifa','haifa');
      insert into teacher_service_areas(teacher_id,city_id)
        select id,case when slug=(select slug from subjects where name_he='מתמטיקה - חטיבת ביניים') then 1 else 2 end from teacher_profiles;
      insert into levels(id,name_he,name_en,slug) values (1,'Legacy','Legacy','legacy');`);
  }, 30000);
  afterAll(async () => { await db.close(); });

  async function search(name: string, args = '') {
    return db.query<{ slug: string }>(`select slug from search_teacher_candidates_v2(
      p_subject_id => (select id from subjects where name_he=$1)${args ? `,${args}` : ''})`, [name]);
  }

  it.each(families)('$name_he includes every subsubject without leaking into another category', async (family) => {
    const prefix = family.name_he.slice(0, -' - הכל'.length);
    const expected = catalog.filter(item => item.name_he.split(' - ')[0] === prefix).map(item => item.slug).sort();
    const result = await search(family.name_he, 'p_limit => 200');
    expect(result.rows.map(item => item.slug).sort()).toEqual(expected);
    const count = await db.query<{ count: number }>(`select count_teacher_candidates_v2(
      p_subject_id => (select id from subjects where slug=$1))::integer as count`, [family.slug]);
    expect(count.rows[0].count).toBe(expected.length);
  });

  it('keeps a specific subject exact and ignores retired levels even in legacy RPC calls', async () => {
    const expected = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!;
    expect((await search(expected.name_he, 'p_level_id => 99999')).rows).toEqual([{ slug: expected.slug }]);
    expect((await db.query<{ slug: string }>(`select slug from search_teacher_candidates(
      p_subject_id => (select id from subjects where slug=$1), p_level_id => 99999)`, [expected.slug])).rows).toEqual([{ slug: expected.slug }]);
  });

  it('returns only teachers serving the selected city in the in-person group', async () => {
    const result = await search('מתמטיקה - הכל', 'p_city_id => 1, p_online_ok => false, p_in_person_ok => true');
    expect(result.rows).toEqual([{ slug: catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug }]);
    expect((await search('מתמטיקה - הכל', 'p_city_id => 99999, p_online_ok => false, p_in_person_ok => true')).rows).toEqual([]);
  });

  it('keeps online lessons independent of city without admitting in-person-only teachers', async () => {
    const slug = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug;
    await db.query('update teacher_profiles set teaches_online=false where slug=$1', [slug]);
    try {
      const result = await search('מתמטיקה - הכל', 'p_city_id => 1, p_online_ok => true, p_in_person_ok => false, p_limit => 200');
      expect(result.rows.map(item => item.slug).sort()).toEqual(
        catalog.filter(item => item.name_he.startsWith('מתמטיקה - ') && item.slug !== slug).map(item => item.slug).sort(),
      );
    } finally {
      await db.query('update teacher_profiles set teaches_online=true where slug=$1', [slug]);
    }
  });

  it('uses identical filters for results and counts, with stable pagination and no duplicate teachers', async () => {
    const teacherSlug = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug;
    await db.query(`insert into teacher_subjects(teacher_id,subject_id)
      select md5($1)::uuid,id from subjects where name_he='מתמטיקה - הכל'`, [teacherSlug]);
    try {
      const expectedCount = catalog.filter(item => item.name_he.startsWith('מתמטיקה - ')).length;
      const pages = [];
      for (let offset = 0; offset < expectedCount; offset += 3) {
        pages.push(...(await search('מתמטיקה - הכל', `p_limit => 3, p_offset => ${offset}, p_sort => 'price_asc'`)).rows.map(item => item.slug));
      }
      expect(pages).toHaveLength(expectedCount);
      expect(new Set(pages).size).toBe(expectedCount);
      expect((await search('מתמטיקה - הכל', 'p_budget_min => 101')).rows).toEqual([]);
      expect((await search('מתמטיקה - הכל', 'p_verified_only => true')).rows).toEqual([]);
      expect((await search('מתמטיקה - הכל', 'p_rating_min => 4.5')).rows).toEqual([]);
      expect((await db.query<{ count: number }>(`select count_teacher_candidates_v2(
        p_subject_id => (select id from subjects where name_he='מתמטיקה - הכל'),p_budget_min => 101)::integer as count`)).rows[0].count).toBe(0);
    } finally {
      await db.query(`delete from teacher_subjects where teacher_id=md5($1)::uuid
        and subject_id=(select id from subjects where name_he='מתמטיקה - הכל')`, [teacherSlug]);
    }
  }, 20000);

  it('excludes unpublished teachers and inactive offered subjects from category results and counts', async () => {
    const slug = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug;
    await db.query('update subjects set is_active=false where slug=$1', [slug]);
    try {
      expect((await search('מתמטיקה - הכל', 'p_limit => 200')).rows.map(item => item.slug)).not.toContain(slug);
    } finally {
      await db.query('update subjects set is_active=true where slug=$1', [slug]);
    }
    await db.query("update teacher_profiles set profile_status='draft' where slug=$1", [slug]);
    try {
      expect((await search('מתמטיקה - הכל', 'p_limit => 200')).rows.map(item => item.slug)).not.toContain(slug);
    } finally {
      await db.query("update teacher_profiles set profile_status='published' where slug=$1", [slug]);
    }
  });

  it('persists category matches for an old request with a level, while rejecting unrelated subjects', async () => {
    const request = await db.query<{ id: string }>(`insert into student_requests(subject_id,level_id,online_ok,goal)
      select id,1,true,'Learn mathematics' from subjects where name_he='מתמטיקה - הכל' returning id`);
    const match = (slug: string) => ({
      teacher_id: '', slug, score: 90, rank: 1, subject_score: 100,
      availability_score: 100, location_score: 100, budget_score: 100, quality_score: 50,
    });
    const slug = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug;
    const teacher = await db.query<{ id: string }>('select id from teacher_profiles where slug=$1', [slug]);
    const result = await db.query('select * from persist_matches($1,$2)', [request.rows[0].id, JSON.stringify([{ ...match(slug), teacher_id: teacher.rows[0].id }])]);
    expect(result.rows).toHaveLength(1);
    const other = await db.query<{ id: string }>("select id from teacher_profiles where slug=(select slug from subjects where name_he='אנגלית - הכל')");
    await expect(db.query('select * from persist_matches($1,$2)', [request.rows[0].id, JSON.stringify([{ ...match('other'), teacher_id: other.rows[0].id }])])).rejects.toThrow('hard filters');
    expect((await db.query('select * from matches where request_id=$1', [request.rows[0].id])).rows).toHaveLength(1);
  });

  it('migrates inactive legacy teacher and request links without losing metadata or duplicating subjects', async () => {
    const slug = catalog.find(item => item.name_he === 'מתמטיקה - חטיבת ביניים')!.slug;
    await db.exec(`insert into subjects(name_he,name_en,slug,is_active) values
      ('מתמטיקה','Mathematics','mathematics',false),
      ('בגרות','Bagrut','mathematics-bagrut',false),
      ('3 יחידות','3 units','mathematics-bagrut-3',false);`);
    await db.query(`insert into teacher_subjects(teacher_id,subject_id,experience_years,description)
      select md5($1)::uuid,id,5,'Legacy experience' from subjects where slug in ('mathematics','mathematics-bagrut','mathematics-bagrut-3')`, [slug]);
    await db.query(`insert into teacher_subjects(teacher_id,subject_id,experience_years,description)
      select md5($1)::uuid,id,2,'Current experience' from subjects where name_he='מתמטיקה - הכל'`, [slug]);
    const request = await db.query<{ id: string }>(`insert into student_requests(subject_id,online_ok,goal)
      select id,true,'A legacy mathematics request' from subjects where slug='mathematics-bagrut-3' returning id`);
    await db.exec(await migration('20261023112000_migrate_legacy_subject_assignments'));
    const assignments = await db.query<{ name_he: string; experience_years: number; description: string }>(`select subject.name_he,assignment.experience_years,assignment.description
      from teacher_subjects assignment join subjects subject on subject.id=assignment.subject_id where teacher_id=md5($1)::uuid order by subject.name_he`, [slug]);
    expect(assignments.rows).toHaveLength(3);
    expect(assignments.rows.find(item => item.name_he === 'מתמטיקה - הכל')).toMatchObject({ experience_years: 5, description: 'Current experience\nLegacy experience' });
    expect(assignments.rows.find(item => item.name_he === 'מתמטיקה - 3 יח"ל')).toMatchObject({ experience_years: 5, description: 'Legacy experience' });
    expect((await db.query<{ name_he: string }>(`select subject.name_he from student_requests request
      join subjects subject on subject.id=request.subject_id where request.id=$1`, [request.rows[0].id])).rows).toEqual([{ name_he: 'מתמטיקה - 3 יח"ל' }]);
    expect((await search('מתמטיקה - הכל', 'p_limit => 200')).rows.map(item => item.slug)).toContain(slug);
    await db.exec(await migration('20261023112000_migrate_legacy_subject_assignments'));
    expect((await db.query('select * from teacher_subjects where teacher_id=md5($1)::uuid', [slug])).rows).toHaveLength(3);
  });
});
