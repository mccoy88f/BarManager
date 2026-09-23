import { IsOptional, IsString } from 'class-validator';

/** tableId opzionale: sovrascrive il tavolo eventualmente suggerito in automatico. */
export class AcceptReservationDto {
  @IsOptional()
  @IsString()
  tableId?: string | null;
}
