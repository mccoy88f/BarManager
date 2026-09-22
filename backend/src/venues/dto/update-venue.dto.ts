import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Sotto-dominio: solo minuscole, numeri e trattini (es. "locale-centro"). */
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Slug non valido: usa solo lettere minuscole, numeri e trattini',
  })
  slug?: string;
}
