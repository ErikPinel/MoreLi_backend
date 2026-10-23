import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { EmailDeliveryRunner } from './email/email-delivery-runner.js';

async function bootstrap() {
  const app = await NestFactory.create<INestApplication<Server>>(AppModule);
  const configService = app.get(ConfigService);
  configureApp(app, configService);

  app.enableShutdownHooks();
  app.getHttpServer().once('listening', () => {
    app.get(EmailDeliveryRunner).start();
  });
  await app.listen(configService.getOrThrow<number>('app.port'));
}

// Vercel must finish importing this module before it starts the intercepted server.
void bootstrap().catch((error: unknown) => {
  Logger.error(
    'Failed to start the API',
    error instanceof Error ? error.stack ?? error.message : String(error),
    'Bootstrap',
  );
  process.exit(1);
});
