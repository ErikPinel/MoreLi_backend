import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Database } from '../../database/database.types.js';

type InquiryStatus = Database['public']['Enums']['inquiry_status'];

export class CreateInquiryDto {
  @IsUUID()
  teacherId: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3000)
  message: string;
}

export class RespondInquiryDto {
  @IsIn(['accepted', 'declined'])
  status: Extract<InquiryStatus, 'accepted' | 'declined'>;
}

export class ListInquiriesDto {
  @IsOptional()
  @IsIn(['student', 'teacher'])
  side: 'student' | 'teacher' = 'student';

  @IsOptional()
  @IsIn(['sent', 'viewed', 'accepted', 'declined', 'expired'])
  status?: InquiryStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}