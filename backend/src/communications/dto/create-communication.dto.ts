import { CommunicationType } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';

/**
 * `customerIds` è obbligatorio e non vuoto solo quando `allCustomers` è
 * false (selezione manuale): con `allCustomers` true i destinatari sono
 * calcolati lato server (v. CommunicationsService.resolveRecipients), non
 * quelli eventualmente inviati dal client, che vengono comunque ignorati.
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
}
