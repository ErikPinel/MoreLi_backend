import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  body?: string;
}

export class CreateReviewDto extends UpdateReviewDto {
  @IsUUID()
  inquiryId: string;
}

export class ReviewReplyDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  body: string;
}

export class ModerateReviewReplyDto {
  @IsIn(['published', 'rejected'])
  status: 'published' | 'rejected';
}

export class ListReviewsDto {
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