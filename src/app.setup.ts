import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { json, NextFunction, Request, Response } from 'express';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';

type TracedRequest = Request & { requestId?: string };

export function configureApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  if (configService.getOrThrow<boolean>('app.trustProxy')) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(helmet());
  app.use((request: TracedRequest, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') || randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.use(
    rateLimit({
      windowMs: configService.getOrThrow<number>('app.rateLimitWindowMs'),
      limit: configService.getOrThrow<number>('app.rateLimitMax'),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => request.path === '/api/health',
    }),
  );
  app.enableCors({
    origin: configService.getOrThrow<string[]>('app.corsOrigins'),
  });
  app.use(
    ['/api/admin/professions/bulk', '/api/admin/professions/replace',
      '/api/admin/cities/bulk', '/api/admin/cities/replace'],
    json({ limit: '2mb' }),
  );
  app.use(json());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new RequestLoggingInterceptor());
  app.enableShutdownHooks();
}