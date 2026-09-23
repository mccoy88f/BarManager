import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateReservationSettingsDto {
  @IsOptional()
  @IsBoolean()
  reservationsEnabled?: boolean;

  /** Sopra questa soglia di posti, serve sempre conferma manuale. */
  @IsOptional()
  @IsInt()
  @Min(1)
  reservationAutoConfirmMaxSeats?: number;

  /** Minuti di occupazione di un tavolo, usati per calcolare le sovrapposizioni. */
  @IsOptional()
  @IsInt()
  @Min(15)
  reservationSlotDurationMinutes?: number;

  /** Quanti giorni in avanti si può prenotare dal widget pubblico. */
  @IsOptional()
  @IsInt()
  @Min(1)
  reservationHorizonDays?: number;

  /** Se true, il widget pubblico non blocca mai per capienza superata. */
  @IsOptional()
  @IsBoolean()
  reservationOverbookingUnlimited?: boolean;

  /** Posti extra tollerati sopra la capienza totale prima di bloccare (0 = blocco rigido). */
  @IsOptional()
  @IsInt()
  @Min(0)
  reservationOverbookingExtraSeats?: number;
}
