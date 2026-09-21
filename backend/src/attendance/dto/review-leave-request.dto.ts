import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeaveStatus } from '@prisma/client';

export class ReviewLeaveRequestDto {
  @IsEnum(LeaveStatus)
  status: LeaveStatus;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
