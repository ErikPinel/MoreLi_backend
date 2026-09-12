import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { EmailOutboxService } from './email-outbox.service.js';

@Controller()
export class EmailOutboxController {
  constructor(private readonly outbox: EmailOutboxService) {}

  @Roles('admin')
  @Get('admin/email-delivery')
  status() { return this.outbox.status(); }

  @Roles('admin')
  @Post('admin/email-delivery/process')
  process() { return this.outbox.process(); }

  @Roles('admin')
  @Post('admin/email-delivery/:id/retry')
  retry(@Param('id', new ParseUUIDPipe()) id: string) { return this.outbox.retry(id); }
}