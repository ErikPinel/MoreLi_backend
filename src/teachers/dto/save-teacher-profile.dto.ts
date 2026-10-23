import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AvailabilitySlotDto } from '../../availability/dto/availability.dto.js';

export class SaveTeacherProfileDto {
  @IsString() @MaxLength(100)
  firstName: string;
  @IsString() @MaxLength(100)
  lastName: string;
  @IsString() @MaxLength(30)
  phone: string;
  @IsString() @MaxLength(160) @Matches(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/)
  citySlug: string;
  @IsString() @MaxLength(500)
  avatarPath: string;
  @IsString() @MaxLength(200)
  headline: string;
  @IsString() @MaxLength(5000)
  bio: string;
  @IsInt() @Min(0) @Max(100000)
  hourlyPrice: number;
  @IsInt() @Min(0) @Max(80)
  yearsExperience: number;
  @IsBoolean()
  teachesOnline: boolean;
  @IsBoolean()
  teachesInPerson: boolean;
  @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(160, { each: true })
  subjectSlugs: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(160, { each: true })
  citySlugs: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
  @IsBoolean()
  submitForReview: boolean;
}