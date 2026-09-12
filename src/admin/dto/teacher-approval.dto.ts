import { IsString, MinLength } from 'class-validator';

export class TeacherApprovalTokenDto {
  @IsString()
  @MinLength(40)
  token: string;
}