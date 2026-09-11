import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

@Controller('protected-test')
class ProtectedTestController {
  @Get()
  getProtectedResource() {
    return { authenticated: true };
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtectedTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  it('/protected-test (GET) requires a user access token', () => {
    return request(app.getHttpServer())
      .get('/api/protected-test')
      .expect(401);
  });

  it('/api/health (GET) checks the hosted database', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({ status: 'ok', database: 'reachable' });
        expect(headers['x-request-id']).toBeTypeOf('string');
        expect(headers['x-content-type-options']).toBe('nosniff');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
