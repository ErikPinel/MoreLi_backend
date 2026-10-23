import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class ListLessonsDto {
  @IsIn(['student', 'teacher'])
  side: 'student' | 'teacher' = 'student';

  @IsIn(['upcoming', 'week', 'past', 'needs_action', 'completed', 'all'])
  view: 'upcoming' | 'week' | 'past' | 'needs_action' | 'completed' | 'all' = 'upcoming';

  @IsOptional() @IsUUID()
  studentId?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  from?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  to?: string;

  @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}

export class SaveLessonDto {
  @IsUUID()
  requestKey: string;

  @IsUUID()
  studentId: string;

  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt: string;

  @IsISO8601({ strict: true }) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  endsAt: string;

  @IsIn(['online', 'in_person'])
  mode: 'online' | 'in_person';
}

export class TeacherLessonCalendarDto {
  @Type(() => Number) @IsIn([30, 45, 60, 90, 120, 180, 240])
  duration = 60;

  @IsOptional() @IsUUID()
  lessonId?: string;
}
