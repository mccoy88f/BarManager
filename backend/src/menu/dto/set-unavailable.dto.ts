import { IsOptional, IsISO8601 } from 'class-validator';

export class SetUnavailableDto {
  /** Data/ora fino a cui la voce è "non disponibile"; omesso/null = torna subito disponibile. */
  @IsOptional()
  @IsISO8601()
  until?: string | null;
}
