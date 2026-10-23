import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsUUID() requestKey: string;
  @IsIn(['support','bug','billing','report','onboarding']) category: string;
  @IsString() @MinLength(5) @MaxLength(160) subject: string;
  @IsString() @MinLength(10) @MaxLength(4000) message: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() inquiryId?: string;
  @IsOptional() @IsUUID() reviewId?: string;
  @IsOptional() @IsUUID() lessonId?: string;
}
export class ReplySupportTicketDto {
  @IsString() @MinLength(5) @MaxLength(3000) body: string;
  @IsOptional() @IsIn(['open','in_progress','waiting_customer','resolved','rejected']) status?: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'rejected';
}
export class ListSupportTicketsDto {
  @IsOptional() @IsIn(['open','in_progress','waiting_customer','resolved','rejected']) status?: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'rejected';
  @IsOptional() @IsIn(['actionable']) view?: 'actionable';
  @IsOptional() @IsUUID() ticketId?: string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) limit=20;
}