import { CleaningFrequencyUnit } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCleaningTaskDto {
  @IsString()
  description: string;

  @IsString()
  location: string;

  @IsEnum(CleaningFrequencyUnit)
  frequencyUnit: CleaningFrequencyUnit;

  @IsOptional()
  @IsInt()
  @Min(1)
  timesPerUnit?: number;
}
