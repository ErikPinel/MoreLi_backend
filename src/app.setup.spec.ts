import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './app.setup.js';

@Controller()
class LimitedController {
  @Get('limited')
  get() { return { ok: true }; }

  @Get('health')
  health() { return { ok: true }; }
}

async function createLimitedApp(trustProxy: boolean): Promise<INestApplication> {
  const module = await Test.createTestingModule({ controllers: [LimitedController] }).compile();
  const app = module.createNestApplication();
  configureApp(app, new ConfigService({ app: { trustProxy, corsOrigins: ['https://client.example'], rateLimitWindowMs: 60000, rateLimitMax: 1 } }));
  await app.init();
  return app;
}

describe('Browser-readable rate limiting', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createLimitedApp(false);
  });
  afterEach(async () => { await app.close(); });

  it('retains Helmet security headers', async () => {
    await request(app.getHttpServer()).get('/api/limited').expect(200)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('X-Frame-Options', 'SAMEORIGIN')
      .expect('Content-Security-Policy', /default-src 'self'/);
  });

  it('excludes health requests from the rate limit', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/limited').expect(200);
    await request(app.getHttpServer()).get('/api/limited').expect(429);
  });

  it('retains CORS and retry-after headers when the request limit is exceeded', async () => {
    await request(app.getHttpServer()).get('/api/limited').set('Origin', 'https://client.example').expect(200);
    await request(app.getHttpServer()).get('/api/limited').set('Origin', 'https://client.example').expect(429)
      .expect('Access-Control-Allow-Origin', 'https://client.example')
      .expect('Retry-After', /\d+/);
  });

  it('does not spend the request allowance on browser preflight', async () => {
    await request(app.getHttpServer()).options('/api/limited').set('Origin', 'https://client.example')
      .set('Access-Control-Request-Method', 'GET').expect(204);
    await request(app.getHttpServer()).get('/api/limited').set('Origin', 'https://client.example').expect(200);
  });
});

describe('Rate limiting behind one trusted proxy', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createLimitedApp(true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('accepts both proxy headers without logging validation errors', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '198.51.100.1')
      .set('Forwarded', 'for=198.51.100.1;proto=https')
      .expect(200);

    expect(errors).not.toHaveBeenCalled();
  });

  it('keeps separate request allowances for different forwarded clients', async () => {
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '198.51.100.1').expect(429);
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '198.51.100.2').expect(200);
  });

  it('does not let an extra untrusted forwarded address reset the allowance', async () => {
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '203.0.113.1, 198.51.100.1').expect(200);
    await request(app.getHttpServer()).get('/api/limited')
      .set('X-Forwarded-For', '203.0.113.2, 198.51.100.1').expect(429);
  });
});