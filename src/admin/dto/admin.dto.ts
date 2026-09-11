import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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