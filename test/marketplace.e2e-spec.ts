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
import { ApprovalTokenService } from '../src/email/approval-token.service.js';
import { EmailService } from '../src/email/email.service.js';

describe('Marketplace journey (e2e)', () => {
  let app: INestApplication;
  let adminClient: SupabaseClient<Database>;
  let approvalTokens: ApprovalTokenService;
  let supabaseUrl: string;
  let publishableKey: string;
  const userIds: string[] = [];
  const eventEntityIds: string[] = [];
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
  let addedApprovalSecret = false;

  beforeAll(async () => {
    if (!process.env.EMAIL_APPROVAL_SECRET) {
      process.env.EMAIL_APPROVAL_SECRET = `e2e-${runId}-approval-secret`;
      addedApprovalSecret = true;
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).overrideProvider(EmailService).useValue({ deliverJob: vi.fn().mockResolvedValue(true) }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();

    const config = app.get(ConfigService);
    supabaseUrl = config.getOrThrow<string>('supabase.url');
    publishableKey = config.getOrThrow<string>('supabase.publishableKey');
    adminClient = app.get(SupabaseService).client;
    approvalTokens = app.get(ApprovalTokenService);

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

    await request(app.getHttpServer())
      .post('/api/teachers/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ acceptTerms: true }).expect(400);
    const account = await request(app.getHttpServer()).get('/api/users/me')
      .set('Authorization', `Bearer ${teacherToken}`).expect(200);
    expect(account.body.role).toBe('student');
    const teacherUserId = account.body.id as string;
    avatarPath = `${teacherUserId}/acceptance-avatar.png`;

    await request(app.getHttpServer()).post('/api/storage/upload-url')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ bucket: 'teacher-avatars', fileName: 'onboarding-avatar.png' }).expect(201);
    await request(app.getHttpServer()).post('/api/storage/upload-url')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ bucket: 'teacher-gallery', fileName: 'gallery.png' }).expect(403);

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
        contactEmail: teacherEmail,
        avatarPath,
      })
      .expect(200);

    const subjects = await request(app.getHttpServer())
      .get('/api/subjects')
      .expect(200);
    const levels = await request(app.getHttpServer())
      .get('/api/levels')
      .expect(200);
    const cities = await request(app.getHttpServer())
      .get('/api/cities')
      .expect(200);

    const subjectId = subjects.body[0].id as number;
    const levelId = levels.body[0].id as number;

    const onboarding = {
      acceptTerms: true, firstName: 'Test', lastName: 'Teacher', phone: '0500000000',
      citySlug: cities.body[0].slug, avatarPath,
      headline: 'Acceptance test mathematics teacher', bio: 'A complete profile created by the hosted acceptance test.',
      hourlyPrice: 120, yearsExperience: 5, teachesOnline: true, teachesInPerson: false,
      subjectSlugs: [subjects.body[0].slug], levelIds: [levelId], citySlugs: [],
      slots: [{ dayOfWeek: 0, startTime: '16:00', endTime: '18:00', timezone: 'Asia/Jerusalem' }],
    };
    await request(app.getHttpServer()).post('/api/teachers/me/onboarding')
      .set('Authorization', `Bearer ${teacherToken}`).send({ ...onboarding, subjectSlugs: ['missing-subject'] }).expect(400);
    await request(app.getHttpServer()).get('/api/users/me').set('Authorization', `Bearer ${teacherToken}`)
      .expect(200).expect(({ body }) => expect(body.role).toBe('student'));
    const submitted = await request(app.getHttpServer()).post('/api/teachers/me/onboarding')
      .set('Authorization', `Bearer ${teacherToken}`).send(onboarding).expect(201);
    expect(submitted.body.profile_status).toBe('pending');
    teacherId = submitted.body.id as string;
    teacherSlug = submitted.body.slug as string;
    eventEntityIds.push(teacherId);
    await request(app.getHttpServer()).post('/api/teachers/me/onboarding')
      .set('Authorization', `Bearer ${teacherToken}`).send(onboarding).expect(201)
      .expect(({ body }) => expect(body.id).toBe(teacherId));

    await request(app.getHttpServer()).get(`/api/teachers/${teacherSlug}`).expect(404);
    await request(app.getHttpServer()).post(`/api/admin/teachers/${teacherId}/approve`)
      .set('Authorization', `Bearer ${studentToken}`).expect(403);
    await request(app.getHttpServer()).post(`/api/admin/teachers/${teacherId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Please clarify your teaching experience.' })
      .expect(201).expect(({ body }) => expect(body.profile_status).toBe('draft'));
    await request(app.getHttpServer()).get('/api/teachers/me').set('Authorization', `Bearer ${teacherToken}`)
      .expect(200).expect(({ body }) => expect(body.review_reason).toContain('clarify'));
    await request(app.getHttpServer()).post('/api/teachers/me/submit-review')
      .set('Authorization', `Bearer ${teacherToken}`).expect(201);

    const approvalToken = approvalTokens.create(teacherId);
    expect(approvalToken).toBeTruthy();
    await request(app.getHttpServer())
      .get('/api/teacher-approvals/preview')
      .query({ token: approvalToken })
      .expect(200)
      .expect(({ body }) => {
        expect(body.teacherId).toBe(teacherId);
        expect(body.profileStatus).toBe('pending');
      });
    await request(app.getHttpServer())
      .post('/api/teacher-approvals/approve')
      .send({ token: approvalToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/teacher-approvals/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ token: approvalToken })
      .expect(201)
      .expect(({ body }) => expect(body.approved).toBe(true));

    await request(app.getHttpServer())
      .get('/api/teachers/me')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.profile_status).toBe('published');
        expect(body.verification_status).toBe('verified');
        expect(body.subjects).toHaveLength(1);
        expect(body.levels).toHaveLength(1);
        expect(body.service_areas).toEqual([]);
        expect(body.availability).toEqual([expect.objectContaining({ day_of_week: 0, start_time: '16:00:00', end_time: '18:00:00', timezone: 'Asia/Jerusalem' })]);
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
        contactSharingConsent: true,
        teacherId,
        requestId,
        requestedStartAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        requestedEndAt: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString(),
        lessonMode: 'online',
        message: 'Can we arrange an introductory lesson?',
      })
      .expect(201);
    const inquiryId = inquiry.body.id as string;
    eventEntityIds.push(inquiryId);
    expect(inquiry.body.contact_sharing_consented_at).toBeTruthy();

    await request(app.getHttpServer()).get('/api/inquiries?side=teacher').set('Authorization', `Bearer ${teacherToken}`)
      .expect(200).expect(({ body }) => {
        const item = body.items.find((entry: { id: string }) => entry.id === inquiryId);
        expect(item.student.contact_email).toBeUndefined();
        expect(item.student.phone).toBeUndefined();
      });
    await request(app.getHttpServer()).get('/api/inquiries?side=student').set('Authorization', `Bearer ${studentToken}`)
      .expect(200).expect(({ body }) => expect(body.items[0].teacher.profile.contact_email).toBeUndefined());

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

    await request(app.getHttpServer()).patch(`/api/inquiries/${inquiryId}/respond`)
      .set('Authorization', `Bearer ${teacherToken}`).send({ status: 'accepted' }).expect(404);
    await request(app.getHttpServer()).get('/api/inquiries?side=teacher&status=accepted')
      .set('Authorization', `Bearer ${teacherToken}`).expect(200).expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0].student.contact_email).toBe(studentEmail);
        expect(body.items[0].student.phone).toBe('0501111111');
      });
    await request(app.getHttpServer()).get('/api/inquiries?side=student&status=accepted')
      .set('Authorization', `Bearer ${studentToken}`).expect(200).expect(({ body }) => {
        expect(body.items[0].teacher.profile.contact_email).toBe(teacherEmail);
        expect(body.items[0].teacher.profile.phone).toBe('0500000000');
      });
    const { data: deliveries, error: deliveryError } = await adminClient.from('email_outbox')
      .select('event_type,audience,payload').eq('entity_id', inquiryId);
    if (deliveryError) throw deliveryError;
    expect(deliveries.filter((entry) => entry.event_type === 'inquiry.sent')).toHaveLength(3);
    expect(deliveries.filter((entry) => entry.event_type === 'inquiry.accepted').map((entry) => entry.audience).sort()).toEqual(['admin', 'student', 'teacher']);

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
  }, 120_000);

  afterAll(async () => {
    if (adminClient && (eventEntityIds.length || userIds.length)) {
      const { error } = await adminClient.from('email_outbox').delete().in('entity_id', [...eventEntityIds, ...userIds]);
      if (error) throw error;
    }
    for (const userId of userIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
    if (avatarPath) {
      await adminClient.storage.from('teacher-avatars').remove([avatarPath]);
    }
    await app.close();
    if (addedApprovalSecret) delete process.env.EMAIL_APPROVAL_SECRET;
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
    const { error: profileError } = await adminClient.from('profiles').update({ phone: '0501111111', contact_email: email }).eq('id', data.user.id);
    if (profileError) throw profileError;
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