import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimAccessPaymentDto {
  @IsString() @MinLength(3) @MaxLength(160) reference: string;
  @Equals(true) acceptTerms: true;
}

export class ReviewAccessPaymentDto {
  @IsBoolean() approve: boolean;
  @IsString() @MaxLength(1000) note: string;
}

export class ListAccessPaymentsDto {
  @IsOptional() @IsUUID() paymentId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsIn(['history']) view?: 'history';
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: 'pending' | 'approved' | 'rejected';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}