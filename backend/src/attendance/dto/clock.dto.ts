import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

/**
 * Esattamente uno tra qrToken/nfcValue/(gpsLat+gpsLng) a seconda del metodo
 * di timbratura usato dal client; nessuno dei tre = timbratura diretta senza
 * verifica (consentita solo se il locale non ha abilitato altri metodi).
 */
export class ClockDto {
  @IsOptional()
  @IsString()
  qrToken?: string;

  @IsOptional()
  @IsString()
  nfcValue?: string;

  @IsOptional()
  @IsLatitude()
  gpsLat?: number;

  @IsOptional()
  @IsLongitude()
  gpsLng?: number;
}
