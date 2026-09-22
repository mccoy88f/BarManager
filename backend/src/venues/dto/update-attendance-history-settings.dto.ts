import { AttendanceRetentionUnit } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateAttendanceHistorySettingsDto {
  @IsOptional()
  @IsBoolean()
  attendanceHistoryVisibleToEmployees?: boolean;

  /** null = nessuna cancellazione automatica. */
  @IsOptional()
  @ValidateIf((o) => o.attendanceRetentionValue !== null)
  @IsInt()
  @Min(1)
  attendanceRetentionValue?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.attendanceRetentionUnit !== null)
  @IsEnum(AttendanceRetentionUnit)
  attendanceRetentionUnit?: AttendanceRetentionUnit | null;
}
