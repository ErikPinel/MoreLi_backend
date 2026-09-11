import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import {
  CreateInquiryDto,
  ListInquiriesDto,
  RespondInquiryDto,
} from './dto/inquiry.dto.js';
import { InquiriesService } from './inquiries.service.js';
import { Inquiry } from './inquiries.repository.js';

@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Post()
  @Roles('student')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInquiryDto,
  ): Promise<Inquiry> {
    return this.inquiriesService.create(user.sub, dto);
  }

  @Get()
  @Roles('student', 'teacher')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListInquiriesDto) {
    return this.inquiriesService.findAll(user.sub, query);
  }

  @Patch(':id/view')
  @Roles('teacher')
  markViewed(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Inquiry> {
    return this.inquiriesService.markViewed(user.sub, id);
  }

  @Patch(':id/respond')
  @Roles('teacher')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RespondInquiryDto,
  ): Promise<Inquiry> {
    return this.inquiriesService.respond(user.sub, id, dto);
  }
}