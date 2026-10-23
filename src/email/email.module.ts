import { Global, Module } from '@nestjs/common';
import { ApprovalTokenService } from './approval-token.service.js';
import { EmailService } from './email.service.js';
import { EmailOutboxService } from './email-outbox.service.js';
import { EmailOutboxController } from './email-outbox.controller.js';
import { EmailDeliveryRunner } from './email-delivery-runner.js';
import { ResendWebhookController } from './resend-webhook.controller.js';

@Global()
@Module({
  controllers: [EmailOutboxController, ResendWebhookController],
  providers: [EmailService, ApprovalTokenService, EmailOutboxService, EmailDeliveryRunner],
  exports: [EmailService, ApprovalTokenService],
})
export class EmailModule {}