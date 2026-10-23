import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { LessonCalendarService } from '../availability/lesson-calendar.service.js';
import { LessonActionDto } from '../inquiries/dto/inquiry.dto.js';
import { ListLessonsDto, SaveLessonDto, TeacherLessonCalendarDto } from './lesson.dto.js';
import { LessonsRepository } from './lessons.repository.js';

@Controller()
export class LessonsController {
  constructor(private readonly repository: LessonsRepository, private readonly calendar: LessonCalendarService) {}

  @Get('lessons') @Roles('student', 'teacher')
  list(@CurrentUser() user: AuthUser, @Query() query: ListLessonsDto) {
    return this.repository.list(user.sub, query);
  }

  @Get('lessons/calendar') @Roles('teacher')
  async availableTimes(@CurrentUser() user: AuthUser, @Query() query: TeacherLessonCalendarDto) {
    const teacherId = await this.repository.teacherId(user.sub);
    if (query.lessonId && (await this.repository.detail(user.sub, query.lessonId)).teacher_id !== teacherId) {
      throw new BadRequestException('ניתן לבדוק הזזת שיעור שלכם בלבד');
    }
    return this.calendar.findTeacher(teacherId, query.duration, query.lessonId);
  }

  @Get('lessons/students/:id') @Roles('teacher')
  student(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.student(user.sub, id);
  }

  @Get('lessons/:id') @Roles('student', 'teacher')
  detail(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.detail(user.sub, id);
  }

  @Get('admin/lessons/:id') @Roles('admin')
  adminDetail(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.detail(user.sub, id, true);
  }

  @Post('lessons') @Roles('teacher')
  async create(@CurrentUser() user: AuthUser, @Body() dto: SaveLessonDto) {
    const teacherId = await this.repository.teacherId(user.sub);
    if (await this.repository.savedRequest(teacherId, dto.requestKey)) return this.repository.save(user.sub, dto);
    await this.repository.student(user.sub, dto.studentId);
    await this.calendar.assertTeacherTime(teacherId, dto.startsAt, dto.endsAt);
    return this.repository.save(user.sub, dto);
  }

  @Patch('lessons/:id') @Roles('teacher')
  async reschedule(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SaveLessonDto) {
    const teacherId = await this.repository.teacherId(user.sub);
    const lesson = await this.repository.detail(user.sub, id);
    if (lesson.teacher_id !== teacherId || lesson.student_id !== dto.studentId) throw new BadRequestException('ניתן להזיז רק שיעור שלכם, עם אותו תלמיד');
    await this.calendar.assertTeacherTime(teacherId, dto.startsAt, dto.endsAt, id);
    return this.repository.save(user.sub, dto, id);
  }

  @Patch('lessons/:id/state') @Roles('student', 'teacher')
  state(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: LessonActionDto) {
    return this.repository.updateState(user.sub, id, dto);
  }
}
