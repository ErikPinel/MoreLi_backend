import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TeacherSubjectDto {
  @IsInt()
  @Min(1)
  subjectId: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  experienceYears?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ReplaceTeacherSubjectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeacherSubjectDto)
  subjects: TeacherSubjectDto[];
}

export class ReplaceTeacherLevelsDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  levelIds: number[];
}

export class ReplaceTeacherServiceAreasDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  cityIds: number[];
}