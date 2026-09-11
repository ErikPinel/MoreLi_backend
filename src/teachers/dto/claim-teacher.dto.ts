import { Equals } from 'class-validator';

export class ClaimTeacherDto {
  @Equals(true)
  acceptTerms: boolean;
}