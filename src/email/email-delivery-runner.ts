import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailOutboxService } from './email-outbox.service.js';

@Injectable()
export class EmailDeliveryRunner implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailDeliveryRunner.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private started = false;
  private stopped = false;

  constructor(private readonly outbox: EmailOutboxService, private readonly config: ConfigService) {}

  start() {
    if (this.started || this.stopped) return;
    if (!this.config.get<string>('email.resendApiKey') || !this.config.get<string>('email.senderEmail')) {
      this.logger.warn('Automatic email delivery disabled: configure RESEND_API_KEY and a verified RESEND_FROM_EMAIL');
      return;
    }
    if (this.config.get<string>('email.senderEmail')?.toLowerCase().endsWith('@resend.dev')) {
      this.logger.warn('Resend test sender configured; automatic transactional delivery is paused and queued messages are preserved');
      return;
    }
    this.started = true;
    this.logger.log('Automatic email delivery started');
    this.running = this.deliver();
  }

  private async deliver() {
    try {
      const result = await this.outbox.process();
      if (result.processed) this.logger.log(JSON.stringify(result));
    } catch {
      this.logger.error('Email batch failed; will retry automatically');
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => { this.running = this.deliver(); }, 5000);
        this.timer.unref();
      }
    }
  }

  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}