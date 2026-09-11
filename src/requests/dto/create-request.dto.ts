import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRequestDto {
  @IsInt()
  @Min(1)
  subjectId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  levelId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cityId?: number;

  @IsBoolean()
  onlineOk: boolean;

  @IsBoolean()
  inPersonOk: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  budgetMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  budgetMax?: number;

  @IsOptional()
  @IsDateString()
  desiredAt?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  goal: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string;
}