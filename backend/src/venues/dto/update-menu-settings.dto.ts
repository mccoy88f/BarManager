import { Transform } from 'class-transformer';
import { IsEmail, IsHexColor, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { IsIanaTimezone } from '../../common/timezone/is-iana-timezone.decorator';

/** Una stringa vuota significa "svuota il campo": diventa null (non deve fallire IsUrl). */
const emptyToNull = ({ value }: { value: string }) => (value === '' ? null : value);

export class UpdateMenuSettingsDto {
  /** Nome del locale, mostrato ovunque nell'app oltre che nel menù online. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Mittente delle email di ordine ai fornitori, invece di SMTP_FROM. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  menuAddress?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  menuPhone?: string | null;

  /** Non specifico al menù pubblico: usato anche nell'intestazione delle email di ordine ai fornitori (§11). */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  city?: string | null;

  /** Partita IVA del locale: come sopra, usata nell'intestazione delle email di ordine ai fornitori. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  vatNumber?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl()
  menuInstagramUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl()
  menuFacebookUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl()
  menuWebsiteUrl?: string | null;

  /** Fuso orario IANA del locale (es. "Europe/Rome"): usato per ogni calcolo di "oggi" riferito al locale (prenotazioni, ordini, HACCP, pulizie — v. common/timezone). */
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;

  /** Colore di accento del tema (barra in alto, pulsanti, icone della navigazione, "theme-color" della PWA). Stringa vuota = torna al colore di default. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsHexColor()
  themeAccentColor?: string | null;
}
