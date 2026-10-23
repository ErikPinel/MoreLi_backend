import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { ClaimAccessPaymentDto, ListAccessPaymentsDto, ReviewAccessPaymentDto } from './access.dto.js';
import { AccessRepository } from './access.repository.js';

@Controller()
export class AccessController {
  constructor(private readonly repository: AccessRepository, private readonly config: ConfigService) {}

  @Public() @Get('support/contact')
  contact() { return { email: this.config.getOrThrow<string>('support.email'), phone: this.config.getOrThrow<string>('support.phone'), monthlyPriceIls: 60, automaticPaymentsAvailable: false }; }

  @Roles('teacher') @Get('teachers/me/access')
  summary(@CurrentUser() user: AuthUser) { return this.repository.summary(user.sub); }

  @Roles('teacher') @Post('teachers/me/access/payments')
  claim(@CurrentUser() user: AuthUser, @Body() dto: ClaimAccessPaymentDto) { return this.repository.claim(user.sub, dto); }

  @Roles('admin') @Get('admin/access-payments')
  list(@Query() query: ListAccessPaymentsDto) { return this.repository.list(query); }

  @Roles('admin') @Patch('admin/access-payments/:id')
  review(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReviewAccessPaymentDto) { return this.repository.review(user.sub, id, dto); }

  @Roles('admin') @Get('admin/inquiries/:id')
  inquiry(@Param('id', new ParseUUIDPipe()) id: string) { return this.repository.inquiry(id); }
}