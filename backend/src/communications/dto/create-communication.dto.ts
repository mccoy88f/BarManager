import { CommunicationType } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsString, IsUrl, MinLength, ValidateIf } from 'class-validator';

/**
 * `customerIds` è obbligatorio e non vuoto solo quando `allCustomers` è
 * false (selezione manuale): con `allCustomers` true i destinatari sono
 * calcolati lato server (v. CommunicationsService.resolveRecipients), non
 * quelli eventualmente inviati dal client, che vengono comunque ignorati.
 *
 * `ctaLabel`/`ctaUrl`: pulsante opzionale in fondo all'email, tracciato al
 * click (v. CommunicationRecipient.clickedAt) — o entrambi presenti o
 * entrambi assenti, non ha senso un pulsante senza etichetta o senza
 * destinazione.
 */
export class CreateCommunicationDto {
  @IsEnum(CommunicationType)
  type: CommunicationType;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  bodyHtml: string;

  @IsBoolean()
  allCustomers: boolean;

  @ValidateIf((dto: CreateCommunicationDto) => !dto.allCustomers)
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  customerIds?: string[];

  @ValidateIf((dto: CreateCommunicationDto) => !!dto.ctaUrl)
  @IsString()
  @MinLength(1)
  ctaLabel?: string;

  @ValidateIf((dto: CreateCommunicationDto) => !!dto.ctaLabel)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  ctaUrl?: string;
}
