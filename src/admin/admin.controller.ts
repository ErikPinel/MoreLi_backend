import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminService } from './admin.service.js';
import {
  ListAdminReviewsDto,
  ListAdminTeachersDto,
  ModerateReviewDto,
  ModerateTeacherDto,
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

  @Patch('reviews/:id')
  moderateReview(
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.adminService.moderateReview(id, dto);
  }
}