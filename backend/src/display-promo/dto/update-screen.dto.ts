import { DisplayPromoInfoBarTheme, DisplayPromoOrientation, DisplayPromoTransition } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateScreenDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** null = nessuna playlist di default (schermo vuoto fuori dai turni programmati). */
  @IsOptional()
  @IsString()
  defaultPlaylistId?: string | null;

  /** Fascia "da telegiornale" (orologio/meteo/ticker notizie) attorno al carosello, §5.12. */
  @IsOptional()
  @IsBoolean()
  showInfoBar?: boolean;

  /** Rilevante solo se showInfoBar è true. */
  @IsOptional()
  @IsEnum(DisplayPromoInfoBarTheme)
  infoBarTheme?: DisplayPromoInfoBarTheme;

  /** Indipendente da showInfoBar: si applica anche a schermo intero senza la fascia. */
  @IsOptional()
  @IsEnum(DisplayPromoTransition)
  transitionEffect?: DisplayPromoTransition;

  /** Solo organizzativo: come è montato fisicamente questo schermo. */
  @IsOptional()
  @IsEnum(DisplayPromoOrientation)
  orientation?: DisplayPromoOrientation;

  /** null = torna al nome del locale. Ignorato se headerLogoUrl è impostato. */
  @IsOptional()
  @IsString()
  headerText?: string | null;

  /** null = rimuove il logo (torna al testo/nome del locale). Per impostarlo, v. POST .../header-logo. */
  @IsOptional()
  @IsString()
  headerLogoUrl?: string | null;
}
