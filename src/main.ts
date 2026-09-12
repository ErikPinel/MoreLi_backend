import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { EmailDeliveryRunner } from './email/email-delivery-runner.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  configureApp(app, configService);

  await app.listen(configService.getOrThrow<number>('app.port'));
  app.enableShutdownHooks();
  app.get(EmailDeliveryRunner).start();
}
await bootstrap();
