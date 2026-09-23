import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Modifica generale di una prenotazione già presa in carico (dati
 * cliente, note, durata): a differenza del cambio orario, non richiede
 * conferma del cliente — pensata per correggere un dato inserito male o
 * aggiornare una nota, non per rinegoziare l'appuntamento.
 */
export class UpdateReservationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  partySize?: number;

  @IsOptional()
  @IsBoolean()
  isEvent?: boolean;

  @IsOptional()
  @IsString()
  eventNote?: string;

  @IsOptional()
  @IsString()
  allergiesNote?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Durata di occupazione del tavolo per questa prenotazione, in minuti: null torna al default del locale. */
  @IsOptional()
  @IsInt()
  @Min(15)
  slotDurationMinutes?: number | null;
}
