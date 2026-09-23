import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CreateReservationDto } from './create-reservation.dto';

/**
 * Prenotazione aggiunta a mano dallo staff in backoffice (§10 di
 * DEVELOPMENT.md): stessi campi del widget pubblico, più uno o più tavoli
 * opzionali (un gruppo grande può occuparne più di uno) — se assenti,
 * resta nella coda "senza tavolo" da assegnare.
 */
export class CreateManualReservationDto extends CreateReservationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tableIds?: string[];

  /** Durata di occupazione del tavolo per questa prenotazione, in minuti: se assente usa il default del locale. */
  @IsOptional()
  @IsInt()
  @Min(15)
  slotDurationMinutes?: number;
}
