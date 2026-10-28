import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateDisplayPromoSettingsDto {
  @IsOptional()
  @IsBoolean()
  displayPromoEnabled?: boolean;

  /** null = nessuna playlist di default impostata (schermo vuoto fuori dai turni programmati). */
  @IsOptional()
  @IsString()
  displayPromoDefaultPlaylistId?: string | null;
}
