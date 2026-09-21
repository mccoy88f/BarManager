import { AttendanceType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

/** Inserimento manuale di una timbratura da parte dell'admin (es. dipendente che ha dimenticato di timbrare). */
export class AddAttendanceRecordDto {
  @IsString()
  employeeId: string;

  @IsEnum(AttendanceType)
  type: AttendanceType;

  @IsDateString()
  timestamp: string;

  @IsOptional()
  @IsString()
  note?: string;
}
