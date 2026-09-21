import { IsDateString, IsString } from 'class-validator';

export class CorrectAttendanceDto {
  @IsDateString()
  timestamp: string;

  @IsString()
  reason: string; // obbligatorio: motivo della correzione, va nell'audit log
}
