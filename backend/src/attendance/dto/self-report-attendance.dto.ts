import { IsDateString } from 'class-validator';

/** "Ho dimenticato di timbrare": il dipendente dichiara data/ora, l'admin conferma o rifiuta. */
export class SelfReportAttendanceDto {
  @IsDateString()
  timestamp: string;
}
