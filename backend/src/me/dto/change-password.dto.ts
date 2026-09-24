import { IsString, MinLength } from 'class-validator';

/** Richiede sempre la password attuale, per lo stesso motivo per cui la richiede qualunque servizio: un token valido non basta a dimostrare che sia davvero l'utente a chiederlo (sessione lasciata aperta, dispositivo condiviso). */
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
