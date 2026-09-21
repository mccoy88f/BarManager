import { TaskRecurrence, TaskType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsEnum(TaskRecurrence)
  recurrence?: TaskRecurrence;

  @IsOptional()
  @IsString()
  relatedEmployeeId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}
