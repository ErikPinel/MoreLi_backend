import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminService } from './admin.service.js';
import {
  ListAdminReviewsDto,
  ListAdminTeachersDto,
  ModerateReviewDto,
  ModerateTeacherDto,
  ReplaceCitiesDto,
  ReplaceProfessionsDto,
  RejectTeacherDto,
} from './dto/admin.dto.js';

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('teachers')
  findTeachers(@Query() query: ListAdminTeachersDto) {
    return this.adminService.findTeachers(query);
  }

  @Patch('teachers/:id')
  moderateTeacher(
    @Param('id') id: string,
    @Body() dto: ModerateTeacherDto,
  ) {
    return this.adminService.moderateTeacher(id, dto);
  }

  @Get('reviews')
  findReviews(@Query() query: ListAdminReviewsDto) {
    return this.adminService.findReviews(query);
  }

  @Post('teachers/:id/approve')
  approveTeacher(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.adminService.approveTeacher(id, user.sub);
  }

  @Post('teachers/:id/reject')
  rejectTeacher(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body() dto: RejectTeacherDto) {
    return this.adminService.rejectTeacher(id, user.sub, dto.reason);
  }

  @Patch('reviews/:id')
  moderateReview(
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.adminService.moderateReview(id, dto);
  }

  @Post(['professions/bulk', 'professions/replace'])
  replaceProfessions(@Body() dto: ReplaceProfessionsDto) {
    return this.adminService.replaceProfessions(dto);
  }

  @Post(['cities/bulk', 'cities/replace'])
  replaceCities(@Body() dto: ReplaceCitiesDto) {
    return this.adminService.replaceCities(dto);
  }
}