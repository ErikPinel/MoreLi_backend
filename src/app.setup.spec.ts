import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './app.setup.js';

@Controller()
class LimitedController {
  @Get('limited')
  get() { return { ok: true }; }
}

describe('Browser-readable rate limiting', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ controllers: [LimitedController] }).compile();
    app = module.createNestApplication();
    configureApp(app, new ConfigService({ app: { trustProxy: false, corsOrigins: ['https://client.example'], rateLimitWindowMs: 60000, rateLimitMax: 1 } }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });

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