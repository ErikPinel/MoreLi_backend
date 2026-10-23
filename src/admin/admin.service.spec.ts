import { BadRequestException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../app.setup.js';
import { AdminController } from './admin.controller.js';
import { ApprovalTokenService } from '../email/approval-token.service.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import { SupabaseService } from '../database/supabase.service.js';
import { AccessRepository } from '../access/access.repository.js';
import { AccessController } from '../access/access.controller.js';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';

describe('Catalog HTTP transport', () => {
  let app: INestApplication;
  const items = Array.from({ length: 2000 }, (_, index) => ({
    name_he: `Catalog name ${'a'.repeat(70)} ${index}`,
    slug: `catalog-${index}`,
  }));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{
        provide: AdminService,
        useValue: {
          findTeacherHistory: (query: Record<string, unknown>) => query,
          moderateTeacher: (_id: string, dto: { profileStatus: string }) => dto,
          replaceProfessions: (dto: { professions: unknown[] }) => ({ updated_count: dto.professions.length }),
          replaceCities: (dto: { cities: unknown[] }) => ({ updated_count: dto.cities.length }),
        },
      }],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app, new ConfigService({ app: {
      trustProxy: false,
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
      corsOrigins: [],
    } }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('parses normal JSON routes as well as catalog uploads', async () => {
    await request(app.getHttpServer()).patch('/api/admin/teachers/test-id')
      .send({ profileStatus: 'suspended' }).expect(200).expect({ profileStatus: 'suspended' });
  });

  it('validates teacher history filters and transforms bounded pagination', async () => {
    const teacherId = '00000000-0000-4000-8000-000000000001';
    await request(app.getHttpServer()).get(`/api/admin/teacher-history?teacherId=${teacherId}&status=draft&page=2&limit=5`)
      .expect(200).expect({ teacherId, status: 'draft', page: 2, limit: 5 });
    for (const query of ['teacherId=not-an-id', 'page=0', 'limit=51', 'status=approved']) {
      await request(app.getHttpServer()).get(`/api/admin/teacher-history?${query}`).expect(400);
    }
  });

  it.each(['cities', 'professions'])('accepts full %s bodies and validates nested fields', async (catalog) => {
    const body = JSON.stringify({ [catalog]: items }, null, 2);
    expect(Buffer.byteLength(body)).toBeGreaterThan(102400);
    for (const route of ['bulk', 'replace']) {
      await request(app.getHttpServer()).post(`/api/admin/${catalog}/${route}`)
        .set('Content-Type', 'application/json').send(body)
        .expect(201).expect({ updated_count: 2000 });
    }
    await request(app.getHttpServer()).post(`/api/admin/${catalog}/bulk`)
      .send({ [catalog]: [{ name_he: 'Name', slug: 'INVALID SLUG', id: 1 }] })
      .expect(400);
  });
});

describe('AdminService', () => {
  const createService = () => {
    const adminRepository = {
      replaceProfessions: vi.fn().mockResolvedValue({ updated_count: 2 }),
      replaceCities: vi.fn().mockResolvedValue({ updated_count: 2 }),
    } as unknown as AdminRepository;
    const service = new AdminService(
      adminRepository,
      {} as ApprovalTokenService,
    );
    return { adminRepository, service };
  };

  it('trims and replaces the profession catalog', async () => {
    const { adminRepository, service } = createService();

    await expect(
      service.replaceProfessions({
        professions: [
          { name_he: ' מתמטיקה ', slug: 'mathematics' },
          { name_he: 'אנגלית', slug: 'ENGLISH' },
        ],
      }),
    ).resolves.toEqual({ updated_count: 2 });
    expect(adminRepository.replaceProfessions).toHaveBeenCalledWith([
      { name_he: 'מתמטיקה', slug: 'mathematics' },
      { name_he: 'אנגלית', slug: 'english' },
    ]);
  });

  it('rejects duplicate profession names after trimming', () => {
    const { service } = createService();

    expect(() =>
      service.replaceProfessions({
        professions: [
          { name_he: 'מתמטיקה', slug: 'mathematics' },
          { name_he: ' מתמטיקה ', slug: 'other-mathematics' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('prevents generic moderation from bypassing pending review', () => {
    const { service } = createService();
    expect(() => service.moderateTeacher('teacher-id', { profileStatus: 'published' }))
      .toThrow(BadRequestException);
    expect(() => service.moderateTeacher('teacher-id', { verificationStatus: 'verified' }))
      .toThrow(BadRequestException);
  });

  it('trims and replaces the city catalog', async () => {
    const { adminRepository, service } = createService();

    await expect(
      service.replaceCities({
        cities: [
          { name_he: ' ירושלים ', slug: 'jerusalem' },
          { name_he: 'חיפה', slug: 'HAIFA' },
        ],
      }),
    ).resolves.toEqual({ updated_count: 2 });
    expect(adminRepository.replaceCities).toHaveBeenCalledWith([
      { name_he: 'ירושלים', slug: 'jerusalem' },
      { name_he: 'חיפה', slug: 'haifa' },
    ]);
  });

  it('rejects duplicate city slugs after normalization', () => {
    const { service } = createService();

    expect(() =>
      service.replaceCities({
        cities: [
          { name_he: 'ירושלים', slug: 'jerusalem' },
          { name_he: 'ירושלים החדשה', slug: 'JERUSALEM' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('bulk upserts both catalogs by slug without replacing IDs or coordinates', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const repository = new AdminRepository({ client: { from } } as unknown as SupabaseService);
    const items = [{ name_he: 'ירושלים', slug: 'jerusalem' }];
    await expect(repository.replaceCities(items)).resolves.toEqual({ updated_count: 1 });
    expect(from).toHaveBeenCalledWith('cities');
    expect(upsert).toHaveBeenLastCalledWith([
      { name_he: 'ירושלים', name_en: 'ירושלים', slug: 'jerusalem', is_active: true },
    ], { onConflict: 'slug' });
    await expect(repository.replaceProfessions(items)).resolves.toEqual({ updated_count: 1 });
    expect(from).toHaveBeenCalledWith('subjects');
    expect(upsert).toHaveBeenLastCalledWith([
      { name_he: 'ירושלים', name_en: 'ירושלים', slug: 'jerusalem', is_active: true, sort_order: 10 },
    ], { onConflict: 'slug' });
  });
});

describe('Persisted admin decision history', () => {
  const actor = { id: 'admin-id', first_name: 'Admin', last_name: 'Reviewer', contact_email: 'admin@example.com' };
  const teacher = { id: 'teacher-id', slug: 'teacher', profile: { first_name: 'Test', last_name: 'Teacher', contact_email: 'teacher@example.com' } };
  const event = { id: 'event-id', teacher_id: teacher.id, actor_id: actor.id, previous_status: 'pending', next_status: 'draft', reason: 'Complete profile details', created_at: '2026-10-23T08:00:00Z' };
  const setup = (rows: Record<string, unknown>[]) => {
    const records = { data: rows, error: null, select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis() };
    const teachers = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [teacher], error: null }) };
    const actors = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [actor], error: null }) };
    const from = vi.fn((table: string) => table === 'profiles' ? actors : table === 'teacher_profiles' ? teachers : records);
    const supabase = { client: { from } } as unknown as SupabaseService;
    return { records, actors, from, admin: new AdminRepository(supabase), access: new AccessRepository(supabase) };
  };

  it('keeps history reads behind admin role metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, AccessController.prototype.list)).toEqual(['admin']);
  });

  it('reads persisted profile transitions with actor, reason, stable order and teacher filter', async () => {
    const { admin, records, actors } = setup([event]);
    await expect(admin.findTeacherHistory({ teacherId: teacher.id, status: 'draft', page: 2, limit: 5 }, 5, 6)).resolves.toEqual([{ ...event, teacher, actor }]);
    expect(records.order.mock.calls).toEqual([['created_at', { ascending: false }], ['id']]);
    expect(records.range).toHaveBeenCalledWith(5, 10);
    expect(records.eq).toHaveBeenCalledWith('teacher_id', teacher.id);
    expect(records.eq).toHaveBeenCalledWith('next_status', 'draft');
    expect(actors.in).toHaveBeenCalledWith('id', [actor.id]);
  });

  it('does not invent an actor for historical records without one', async () => {
    const { admin, actors } = setup([{ ...event, actor_id: null }]);
    const result = await admin.findTeacherHistory({ page: 1, limit: 20 }, 0, 21);
    expect(result[0].actor).toBeNull();
    expect(actors.in).not.toHaveBeenCalled();
  });

  it('paginates historical decisions without losing the hasMore sentinel', async () => {
    const findTeacherHistory = vi.fn().mockResolvedValue([event, { ...event, id: 'second' }, { ...event, id: 'third' }]);
    const service = new AdminService({ findTeacherHistory } as unknown as AdminRepository, {} as ApprovalTokenService);
    const query = { page: 2, limit: 2 };
    const result = await service.findTeacherHistory(query);
    expect(findTeacherHistory).toHaveBeenCalledWith(query, 2, 3);
    expect(result).toMatchObject({ page: 2, limit: 2, hasMore: true });
    expect(result.items).toHaveLength(2);
  });

  it('loads decided payments by decision time with the saved reviewer and teacher filter', async () => {
    const payment = { id: 'payment-id', teacher_id: teacher.id, reviewed_by: actor.id, status: 'rejected', reviewed_at: event.created_at, review_note: 'Receipt not found' };
    const { access, records } = setup([payment]);
    const result = await access.list({ view: 'history', status: 'rejected', teacherId: teacher.id, page: 2, limit: 5 });
    expect(records.not).toHaveBeenCalledWith('reviewed_at', 'is', null);
    expect(records.order).toHaveBeenCalledWith('reviewed_at', { ascending: false });
    expect(records.range).toHaveBeenCalledWith(5, 10);
    expect(records.eq).toHaveBeenCalledWith('teacher_id', teacher.id);
    expect(records.eq).toHaveBeenCalledWith('status', 'rejected');
    expect(result.items).toEqual([{ ...payment, teacher, reviewer: actor }]);
  });

  it('does not include an unknown reviewer or query names for an empty queue', async () => {
    const { access, actors } = setup([]);
    expect((await access.list({ page: 1, limit: 20 })).items).toEqual([]);
    expect(actors.in).not.toHaveBeenCalled();
  });
});