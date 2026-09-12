import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import {
  ReplaceTeacherLevelsDto,
  ReplaceTeacherServiceAreasDto,
  ReplaceTeacherSubjectsDto,
} from './dto/replace-teacher-collections.dto.js';
import { SearchTeachersDto } from './dto/search-teachers.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto.js';
import {
  PublicTeacher,
  TeacherOnboarding,
  TeacherProfile,
} from './teachers.repository.js';
import { TeacherSearchResult, TeachersService } from './teachers.service.js';

@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Public()
  @Get()
  search(@Query() query: SearchTeachersDto): Promise<TeacherSearchResult> {
    return this.teachersService.search(query);
  }

  @Get('me')
  @Roles('teacher')
  findMe(@CurrentUser() user: AuthUser): Promise<TeacherOnboarding> {
    return this.teachersService.findMe(user.sub);
  }

  @Post('me')
  createDraft(): never {
    throw new BadRequestException('יש למלא את פרופיל ההוראה וללחוץ על שמירה ושליחה לבדיקה.');
  }

  @Patch('me')
  @Roles('teacher')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTeacherDto,
  ): Promise<TeacherProfile> {
    return this.teachersService.updateMe(user.sub, dto);
  }

  @Post('me/onboarding')
  @Roles('student', 'teacher')
  submitOnboarding(@CurrentUser() user: AuthUser, @Body() dto: SubmitOnboardingDto) {
    return this.teachersService.submitOnboarding(user.sub, dto);
  }

  @Put('me/subjects')
  @Roles('teacher')
  replaceSubjects(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceTeacherSubjectsDto,
  ) {
    return this.teachersService.replaceSubjects(user.sub, dto);
  }

  @Put('me/levels')
  @Roles('teacher')
  replaceLevels(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceTeacherLevelsDto,
  ) {
    return this.teachersService.replaceLevels(user.sub, dto);
  }

  @Put('me/service-areas')
  @Roles('teacher')
  replaceServiceAreas(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceTeacherServiceAreasDto,
  ) {
    return this.teachersService.replaceServiceAreas(user.sub, dto);
  }

  @Post('me/submit-review')
  @Roles('teacher')
  submitForReview(@CurrentUser() user: AuthUser): Promise<TeacherProfile> {
    return this.teachersService.submitForReview(user.sub);
  }

  @Post('me/publish')
  @Roles('teacher')
  publishCompatibility(@CurrentUser() user: AuthUser): Promise<TeacherProfile> {
    return this.teachersService.submitForReview(user.sub);
  }

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<PublicTeacher> {
    return this.teachersService.findPublicBySlug(slug);
  }
}