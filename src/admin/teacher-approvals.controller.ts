import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { AdminService } from './admin.service.js';
import { TeacherApprovalTokenDto } from './dto/teacher-approval.dto.js';

@Controller('teacher-approvals')
export class TeacherApprovalsController {
  constructor(private readonly adminService: AdminService) {}

  @Public()
  @Get('preview')
  preview(@Query() query: TeacherApprovalTokenDto) {
    return this.adminService.previewTeacherApproval(query.token);
  }

  @Roles('admin')
  @Post('approve')
  approve(@Body() body: TeacherApprovalTokenDto, @CurrentUser() user: AuthUser) {
    return this.adminService.approveTeacherByEmail(body.token, user.sub);
  }
}