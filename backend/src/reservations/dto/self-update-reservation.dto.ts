import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Modifica da parte del cliente, senza login, entro la finestra di
 * auto-gestione dalla richiesta (v. ReservationsService.canSelfEdit) —
 * dopo di che deve contattare il locale direttamente. Non include
 * email/orario/tavoli: l'orario resta un'azione del locale (proponi/
 * conferma, §10 di DEVELOPMENT.md), l'email è legata all'identità del
 * cliente nell'anagrafica (§5.8).
 */
export class SelfUpdateReservationDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

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
}
