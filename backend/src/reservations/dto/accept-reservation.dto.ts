import { IsArray, IsOptional, IsString } from 'class-validator';

/** tableIds opzionale: sovrascrive il/i tavolo/i eventualmente suggeriti in automatico. */
export class AcceptReservationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tableIds?: string[];
}
