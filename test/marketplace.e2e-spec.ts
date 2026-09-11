import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Database } from '../src/database/database.types.js';
import { SupabaseService } from '../src/database/supabase.service.js';

describe('Marketplace journey (e2e)', () => {
  let app: INestApplication;
  let adminClient: SupabaseClient<Database>;
  let supabaseUrl: string;
  let publishableKey: string;
  const userIds: string[] = [];
  const runId = randomUUID().replaceAll('-', '');
  const password = `Test-${runId}-aA1!`;
  const teacherEmail = `teacher-${runId}@example.com`;
  const studentEmail = `student-${runId}@example.com`;
  const adminEmail = `admin-${runId}@example.com`;
  let teacherToken: string;
  let studentToken: string;
  let adminToken: string;
  let teacherId: string;
  let teacherSlug: string;
  let avatarPath: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    const config = app.get(ConfigService);
    supabaseUrl = config.getOrThrow<string>('supabase.url');
    publishableKey = config.getOrThrow<string>('supabase.publishableKey');
    adminClient = app.get(SupabaseService).client;

    await createUser(teacherEmail, 'Test', 'Teacher');
    await createUser(studentEmail, 'Test', 'Student');
    const admin = await createUser(adminEmail, 'Test', 'Admin');
    teacherToken = await signIn(teacherEmail);
    studentToken = await signIn(studentEmail);
    adminToken = await signIn(adminEmail);

    const { error } = await adminClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', admin.id);
    if (error) throw error;
  }, 60_000);

  it('completes the authenticated marketplace lifecycle', async () => {
    const roleDenied = await request(app.getHttpServer())
      .get('/api/teachers/me')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(roleDenied.status, JSON.stringify(roleDenied.body)).toBe(403);

    const claim = await request(app.getHttpServer())
      .post('/api/teachers/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ acceptTerms: true })
      .expect(201);
    teacherId = claim.body.id as string;
    teacherSlug = claim.body.slug as string;
    const teacherUserId = claim.body.user_id as string;
    avatarPath = `${teacherUserId}/acceptance-avatar.png`;

    const avatar = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4h8AAAAASUVORK5CYII=',
      'base64',
    );
    const { error: uploadError } = await adminClient.storage
      .from('teacher-avatars')
      .upload(avatarPath, avatar, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        firstName: 'Test',
        lastName: 'Teacher',
        avatarPath,
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/teachers/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        headline: 'Acceptance test mathematics teacher',
        bio: 'A complete profile created by the hosted acceptance test.',
        hourlyPrice: 120,
        currency: 'ILS',
        yearsExperience: 5,
        teachesOnline: true,
        teachesInPerson: false,
      })
      .expect(200);

    const subjects = await request(app.getHttpServer())
      .get('/api/subjects')
      .expect(200);
    const levels = await request(app.getHttpServer())
      .get('/api/levels')
      .expect(200);
    const subjectId = subjects.body[0].id as number;
    const levelId = levels.body[0].id as number;

    await request(app.getHttpServer())
      .put('/api/teachers/me/subjects')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ subjects: [{ subjectId, experienceYears: 5 }] })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/teachers/me/levels')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ levelIds: [levelId] })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/teachers/me/publish')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.profile_status).toBe('published'));

    await request(app.getHttpServer())
      .get('/api/teachers/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.subjects).toHaveLength(1);
        expect(body.levels).toHaveLength(1);
        expect(body.service_areas).toEqual([]);
        expect(body.availability).toEqual([]);
      });

    await request(app.getHttpServer())
      .post('/api/requests')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        subjectId,
        levelId,
        onlineOk: true,
        inPersonOk: false,
        goal: 'Teacher accounts cannot create student requests',
      })
      .expect(403);

    const studentRequest = await request(app.getHttpServer())
      .post('/api/requests')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        subjectId,
        levelId,
        onlineOk: true,
        inPersonOk: false,
        budgetMin: 100,
        budgetMax: 150,
        goal: 'Prepare for a mathematics examination',
      })
      .expect(201);
    const requestId = studentRequest.body.id as string;

    const matches = await request(app.getHttpServer())
      .post(`/api/requests/${requestId}/matches`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);
    expect(matches.body.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.body.some(
        (match: { teacher: { id: string } }) => match.teacher.id === teacherId,
      ),
    ).toBe(true);

    const inquiry = await request(app.getHttpServer())
      .post('/api/inquiries')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        teacherId,
        requestId,
        message: 'Can we arrange an introductory lesson?',
      })
      .expect(201);
    const inquiryId = inquiry.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/inquiries/${inquiryId}/view`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('viewed'));
    await request(app.getHttpServer())
      .patch(`/api/inquiries/${inquiryId}/respond`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'accepted' })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('accepted'));

    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ inquiryId, rating: 5, body: 'Excellent teacher.' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/teachers/${teacherSlug}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.review_count).toBe(1);
        expect(body.average_rating).toBe(5);
        expect(body.user_id).toBeUndefined();
      });

    await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.count).toBeGreaterThanOrEqual(2));
    await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.count).toBeGreaterThanOrEqual(1));

    await request(app.getHttpServer())
      .get('/api/admin/teachers?status=published')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.some((item: { id: string }) => item.id === teacherId)).toBe(
          true,
        );
      });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    const { data: remainingAvatars, error: listError } = await adminClient.storage
      .from('teacher-avatars')
      .list(teacherUserId, { search: 'acceptance-avatar.png' });
    if (listError) throw listError;
    expect(remainingAvatars).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    for (const userId of userIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
    if (avatarPath) {
      await adminClient.storage.from('teacher-avatars').remove([avatarPath]);
    }
    await app.close();
  }, 60_000);

  async function createUser(email: string, firstName: string, lastName: string) {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (error) throw error;
    userIds.push(data.user.id);
    return data.user;
  }

  async function signIn(email: string): Promise<string> {
    const client = createClient<Database>(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data.session.access_token;
  }
});