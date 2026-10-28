import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateScreenDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** null = nessuna playlist di default (schermo vuoto fuori dai turni programmati). */
  @IsOptional()
  @IsString()
  defaultPlaylistId?: string | null;
}
