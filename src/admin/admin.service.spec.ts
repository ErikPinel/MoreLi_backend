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