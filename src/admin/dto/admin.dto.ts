import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Database } from '../../database/database.types.js';

type ProfileStatus = Database['public']['Enums']['teacher_profile_status'];
type VerificationStatus = Database['public']['Enums']['verification_status'];
type ReviewStatus = Database['public']['Enums']['review_status'];

export class ListAdminTeachersDto {
  @IsOptional()
  @IsIn(['draft', 'pending', 'published', 'suspended'])
  status?: ProfileStatus;

  @IsOptional()
  @IsIn(['unverified', 'pending', 'verified'])
  verification?: VerificationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ModerateTeacherDto {
  @IsOptional()
  @IsIn(['unverified', 'pending', 'verified'])
  verificationStatus?: VerificationStatus;

  @IsOptional()
  @IsIn(['published', 'suspended'])
  profileStatus?: Extract<ProfileStatus, 'published' | 'suspended'>;
}

export class ListAdminReviewsDto {
  @IsOptional()
  @IsIn(['pending', 'published', 'rejected'])
  status?: ReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ModerateReviewDto {
  @IsIn(['published', 'rejected'])
  status: Extract<ReviewStatus, 'published' | 'rejected'>;
}

export class CatalogItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name_he: string;

  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;
}

export class ReplaceProfessionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CatalogItemDto)
  professions: CatalogItemDto[];
}

export class ReplaceCitiesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CatalogItemDto)
  cities: CatalogItemDto[];
}

export class RejectTeacherDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason: string;
}