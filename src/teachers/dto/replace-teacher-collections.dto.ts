import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class TeacherSubjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  subjectSlug?: string;

  @ValidateIf((dto: TeacherSubjectDto) => dto.subjectSlug === undefined || dto.subjectId !== undefined)
  @IsInt()
  @Min(1)
  subjectId?: number;

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
  @ValidateIf((dto: ReplaceTeacherServiceAreasDto) => dto.citySlugs === undefined || dto.cityIds !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  cityIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { each: true })
  citySlugs?: string[];
}