import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/** Corpo del widget pubblico di prenotazione (nessun login). */
export class CreateReservationDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  phone: string;

  @IsInt()
  @Min(1)
  partySize: number;

  /** Data/ora richiesta, formato ISO 8601. */
  @IsISO8601()
  reservedAt: string;

  @IsOptional()
  @IsBoolean()
  isEvent?: boolean;

  @IsOptional()
  @IsString()
  eventNote?: string;

  @IsOptional()
  @IsString()
  allergiesNote?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Consenso a ricevere comunicazioni promozionali (email/SMS/WhatsApp), raccolto con una casella dedicata. */
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  /**
   * Autorizzazione al trattamento dei dati personali (GDPR), obbligatoria
   * per il widget pubblico: il controllo "deve essere true" è nel service
   * (`createPublicReservation`), non qui, perché questo stesso DTO è
   * riusato anche dall'aggiunta manuale dello staff, dove non si applica.
   */
  @IsOptional()
  @IsBoolean()
  privacyPolicyConsent?: boolean;
}
