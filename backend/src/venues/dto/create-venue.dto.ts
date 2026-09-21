import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class CreateVenueDto {
  @IsString()
  name: string;

  /** Sotto-dominio: solo minuscole, numeri e trattini (es. "locale-centro"). */
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Slug non valido: usa solo lettere minuscole, numeri e trattini',
  })
  slug: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(8)
  adminPassword: string;
}
