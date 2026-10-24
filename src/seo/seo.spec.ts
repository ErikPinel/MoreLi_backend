import { INestApplication, InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { SupabaseService } from '../database/supabase.service.js';
import { SeoController } from './seo.controller.js';
import { SeoService } from './seo.service.js';

type Row = { id: string; slug: string; profile_status: string };
const publicUrls = ['/', '/teachers', '/teach', '/support', '/teacher-access-terms', '/about.html', '/about-en.html']
  .map(path => `https://morehli.co.il${path}`);

describe('single public sitemap', () => {
  let app: INestApplication;
  let service: SeoService;
  let rows: Row[];
  let failure: { code: string } | null;
  const queries: { after?: string; status?: string; limit?: number; selected?: string }[] = [];

  beforeEach(async () => {
    rows = [];
    failure = null;
    queries.length = 0;
    const supabase = { client: { from: vi.fn((table: string) => {
      expect(table).toBe('teacher_profiles');
      const state: typeof queries[number] = {};
      queries.push(state);
      const query = {
        select: vi.fn((fields: string) => { state.selected = fields; return query; }),
        eq: vi.fn((column: string, value: string) => { expect(column).toBe('profile_status'); state.status = value; return query; }),
        order: vi.fn((column: string, options: { ascending: boolean }) => { expect(column).toBe('id'); expect(options.ascending).toBe(true); return query; }),
        limit: vi.fn((value: number) => { state.limit = value; return query; }),
        gt: vi.fn((column: string, value: string) => { expect(column).toBe('id'); state.after = value; return query; }),
        then: (resolve: (value: { data: Row[] | null; error: typeof failure }) => void) => resolve({
          data: failure ? null : rows.filter(row => row.profile_status === state.status && (!state.after || row.id > state.after)).slice(0, state.limit),
          error: failure,
        }),
      };
      return query;
    }) } };
    const module = await Test.createTestingModule({
      controllers: [SeoController],
      providers: [SeoService, { provide: SupabaseService, useValue: supabase }],
    }).compile();
    service = module.get(SeoService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('serves anonymous XML with only published public URLs and no contact records', async () => {
    rows = [
      { id: '1', slug: 'מורה & <שם>', profile_status: 'published' },
      { id: '2', slug: 'unpublished-person', profile_status: 'pending' },
      { id: '3', slug: 'draft-person', profile_status: 'draft' },
    ];
    const response = await request(app.getHttpServer()).get('/api/seo/sitemap.xml').expect(200)
      .expect('Content-Type', /application\/xml/)
      .expect('Cache-Control', 'public, max-age=0, s-maxage=300');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SeoController.prototype.sitemap)).toBe(true);
    expect([...response.text.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])).toEqual([
      ...publicUrls,
      `https://morehli.co.il/teachers/${encodeURIComponent(rows[0].slug)}`,
    ]);
    expect(response.text).not.toMatch(/sitemapindex|sitemap-pages\.xml|sitemap-teachers\.xml/);
    expect(response.text).toContain(`https://morehli.co.il/teachers/${encodeURIComponent(rows[0].slug)}`);
    expect(response.text).not.toMatch(/unpublished-person|draft-person|email|phone|<שם>/);
    expect(queries[0].selected).toBe('id, slug');
  });

  it.each([0, 1, 499, 500, 501, 1_001, 49_993])('includes all public pages and %i published tutors across database limits', async count => {
    rows = Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(6, '0'), slug: `teacher-${i}`, profile_status: 'published' }));
    const xml = await service.sitemap();
    expect(xml.match(/<url>/g)?.length ?? 0).toBe(count + publicUrls.length);
    expect(new Set([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])).size).toBe(count + publicUrls.length);
    for (const url of publicUrls) expect(xml).toContain(`<loc>${url}</loc>`);
    expect(queries.every(query => query.limit === 500 && query.status === 'published')).toBe(true);
    if (count >= 500) expect(queries[1].after).toBe('000500');
  });

  it('surfaces database failures instead of returning an empty successful sitemap', async () => {
    failure = { code: '08006' };
    await expect(service.sitemap()).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('refuses oversized sitemaps explicitly instead of silently dropping URLs', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    rows = Array.from({ length: 49_994 }, (_, i) => ({ id: String(i + 1).padStart(6, '0'), slug: `teacher-${i}`, profile_status: 'published' }));
    await expect(service.sitemap()).rejects.toThrow('Sitemap capacity exceeded');
  });

  it('retires the separate teacher sitemap endpoint', async () => {
    await request(app.getHttpServer()).get('/api/seo/teachers.xml').expect(404);
  });
});
