import { IsString, MinLength } from 'class-validator';

/** Annullamento da parte del cliente, senza login (stesso token/finestra della modifica). */
export class SelfCancelReservationDto {
  @IsString()
  @MinLength(1)
  token: string;
}
