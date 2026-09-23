import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { OpeningHoursDayDto } from './opening-hours-day.dto';

export class UpdateOpeningHoursDto {
  /** Esattamente 7 giorni (0=domenica..6=sabato), uno per ciascun giorno della settimana. */
  @ValidateNested({ each: true })
  @Type(() => OpeningHoursDayDto)
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  days: OpeningHoursDayDto[];
}
