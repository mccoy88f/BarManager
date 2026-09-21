import { IsOptional, IsString } from 'class-validator';

export class ClockDto {
  /** Omesso = timbratura diretta dall'app (source MANUAL), senza scansione QR. */
  @IsOptional()
  @IsString()
  qrToken?: string;
}
