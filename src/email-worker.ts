import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setInterval } from 'node:timers/promises';
import { AppModule } from './app.module.js';
import { EmailOutboxService } from './email/email-outbox.service.js';

async function bootstrap() {
  const logger = new Logger('EmailWorker');
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--once', '--check'].includes(arg))) throw new Error('Use --once, --check, or no arguments for continuous delivery');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'], abortOnError: false });
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    const config = app.get(ConfigService);
    if (!config.get<string>('email.brevoApiKey') || !config.get<string>('email.senderEmail')) {
      throw new Error('Configure BREVO_API_KEY and BREVO_SENDER_EMAIL before starting delivery');
    }
    const worker = app.get(EmailOutboxService);
    if (args.includes('--check')) {
      const jobs = await worker.status();
      console.info(JSON.stringify({ configured: true, unsentInFirst100: jobs.length, deliveryAttempted: false }));
      return;
    }
    const deliver = async () => {
      try {
        const result = await worker.process();
        console.info(JSON.stringify({ event: 'email-worker.batch', ...result }));
      } catch {
        logger.error('Email batch failed; check database connectivity and delivery configuration');
        if (args.includes('--once')) process.exitCode = 1;
      }
    };
    if (!stop.signal.aborted) await deliver();
    if (args.includes('--once') || stop.signal.aborted) return;
    for await (const tick of setInterval(30_000, undefined, { signal: stop.signal })) {
      void tick;
      if (stop.signal.aborted) break;
      await deliver();
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError' && stop.signal.aborted)) throw error;
  } finally {
    stop.abort();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await app.close();
  }
}

void bootstrap().catch(() => {
  console.error('Email worker could not start. Check server environment configuration; no credentials are logged.');
  process.exitCode = 1;
});