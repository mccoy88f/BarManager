import { TaskRecurrence, TaskType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  title: string;

  /** Importo atteso (§5.5): proposto come importo della Spesa quando questa scadenza viene pagata. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

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
