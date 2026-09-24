import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

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
}
