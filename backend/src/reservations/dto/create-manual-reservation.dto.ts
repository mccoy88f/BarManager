import { IsOptional, IsString } from 'class-validator';
import { CreateReservationDto } from './create-reservation.dto';

/**
 * Prenotazione aggiunta a mano dallo staff in backoffice (§10 di
 * DEVELOPMENT.md): stessi campi del widget pubblico, più un tavolo
 * opzionale — se assente, resta nella coda "senza tavolo" da assegnare.
 */
export class CreateManualReservationDto extends CreateReservationDto {
  @IsOptional()
  @IsString()
  tableId?: string | null;
}
