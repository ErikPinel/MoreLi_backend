import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AvailabilitySlotDto } from '../../availability/dto/availability.dto.js';

export class SubmitOnboardingDto {
  @Equals(true)
  acceptTerms: boolean;

  @IsString() @MinLength(1) @MaxLength(100)
  firstName: string;

  @IsString() @MinLength(1) @MaxLength(100)
  lastName: string;

  @IsString() @MinLength(7) @MaxLength(30)
  phone: string;

  @IsString() @MaxLength(160) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  citySlug: string;

  @IsString() @MinLength(1) @MaxLength(500)
  avatarPath: string;

  @IsString() @MinLength(1) @MaxLength(200)
  headline: string;

  @IsString() @MinLength(1) @MaxLength(5000)
  bio: string;

  @IsInt() @Min(1) @Max(100000)
  hourlyPrice: number;

  @IsInt() @Min(0) @Max(80)
  yearsExperience: number;

  @IsBoolean()
  teachesOnline: boolean;

  @IsBoolean()
  teachesInPerson: boolean;

  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true }) @MaxLength(160, { each: true })
  subjectSlugs: string[];

  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true })
  levelIds: number[];

  @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(160, { each: true })
  citySlugs: string[];

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
}