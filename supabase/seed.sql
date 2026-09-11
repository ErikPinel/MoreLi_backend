begin;

insert into public.levels (name_he, name_en, slug, sort_order)
values
  ('יסודי', 'Elementary school', 'elementary-school', 10),
  ('חטיבת ביניים', 'Middle school', 'middle-school', 20),
  ('תיכון', 'High school', 'high-school', 30),
  ('בגרות', 'Bagrut', 'bagrut', 40),
  ('אקדמיה', 'Higher education', 'higher-education', 50),
  ('מבוגרים', 'Adults', 'adults', 60)
on conflict (slug) do update set
  name_he = excluded.name_he,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  is_active = true
where (levels.name_he, levels.name_en, levels.sort_order, levels.is_active)
  is distinct from (
    excluded.name_he,
    excluded.name_en,
    excluded.sort_order,
    true
  );

insert into public.subjects (name_he, name_en, slug, sort_order)
values
  ('מתמטיקה', 'Mathematics', 'mathematics', 10),
  ('אנגלית', 'English', 'english', 20),
  ('עברית', 'Hebrew', 'hebrew', 30),
  ('פיזיקה', 'Physics', 'physics', 40),
  ('כימיה', 'Chemistry', 'chemistry', 50),
  ('ביולוגיה', 'Biology', 'biology', 60),
  ('מדעי המחשב', 'Computer science', 'computer-science', 70)
on conflict (slug) do update set
  name_he = excluded.name_he,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  is_active = true
where (subjects.name_he, subjects.name_en, subjects.sort_order, subjects.is_active)
  is distinct from (
    excluded.name_he,
    excluded.name_en,
    excluded.sort_order,
    true
  );

with parent as (
  select id from public.subjects where slug = 'mathematics'
)
insert into public.subjects (parent_id, name_he, name_en, slug, sort_order)
select parent.id, child.name_he, child.name_en, child.slug, child.sort_order
from parent
cross join (
  values
    ('יסודי', 'Elementary mathematics', 'mathematics-elementary', 10),
    ('חטיבה', 'Middle-school mathematics', 'mathematics-middle-school', 20),
    ('בגרות', 'Bagrut mathematics', 'mathematics-bagrut', 30)
) as child (name_he, name_en, slug, sort_order)
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_he = excluded.name_he,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  is_active = true
where (
  subjects.parent_id,
  subjects.name_he,
  subjects.name_en,
  subjects.sort_order,
  subjects.is_active
) is distinct from (
  excluded.parent_id,
  excluded.name_he,
  excluded.name_en,
  excluded.sort_order,
  true
);

with parent as (
  select id from public.subjects where slug = 'mathematics-bagrut'
)
insert into public.subjects (parent_id, name_he, name_en, slug, sort_order)
select parent.id, child.name_he, child.name_en, child.slug, child.sort_order
from parent
cross join (
  values
    ('3 יחידות', '3 units', 'mathematics-bagrut-3', 10),
    ('4 יחידות', '4 units', 'mathematics-bagrut-4', 20),
    ('5 יחידות', '5 units', 'mathematics-bagrut-5', 30)
) as child (name_he, name_en, slug, sort_order)
on conflict (slug) do update set
  parent_id = excluded.parent_id,
  name_he = excluded.name_he,
  name_en = excluded.name_en,
  sort_order = excluded.sort_order,
  is_active = true
where (
  subjects.parent_id,
  subjects.name_he,
  subjects.name_en,
  subjects.sort_order,
  subjects.is_active
) is distinct from (
  excluded.parent_id,
  excluded.name_he,
  excluded.name_en,
  excluded.sort_order,
  true
);

insert into public.cities (
  name_he,
  name_en,
  slug,
  latitude,
  longitude
)
values
  ('ירושלים', 'Jerusalem', 'jerusalem', 31.768300, 35.213700),
  ('תל אביב-יפו', 'Tel Aviv-Yafo', 'tel-aviv-yafo', 32.085300, 34.781800),
  ('חיפה', 'Haifa', 'haifa', 32.794000, 34.989600),
  ('ראשון לציון', 'Rishon LeZion', 'rishon-lezion', 31.973000, 34.792500),
  ('פתח תקווה', 'Petah Tikva', 'petah-tikva', 32.084000, 34.887800),
  ('אשדוד', 'Ashdod', 'ashdod', 31.804400, 34.655300),
  ('נתניה', 'Netanya', 'netanya', 32.321500, 34.853200),
  ('באר שבע', 'Beersheba', 'beersheba', 31.252000, 34.791500),
  ('חולון', 'Holon', 'holon', 32.015800, 34.787400),
  ('בני ברק', 'Bnei Brak', 'bnei-brak', 32.083300, 34.833300),
  ('רמת גן', 'Ramat Gan', 'ramat-gan', 32.068400, 34.824800),
  ('רחובות', 'Rehovot', 'rehovot', 31.894800, 34.811300),
  ('הרצליה', 'Herzliya', 'herzliya', 32.166300, 34.843300)
on conflict (slug) do update set
  name_he = excluded.name_he,
  name_en = excluded.name_en,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  is_active = true
where (
  cities.name_he,
  cities.name_en,
  cities.latitude,
  cities.longitude,
  cities.is_active
) is distinct from (
  excluded.name_he,
  excluded.name_en,
  excluded.latitude,
  excluded.longitude,
  true
);

commit;