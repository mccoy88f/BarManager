import { IsISO8601 } from 'class-validator';

/** Nuovo orario proposto dal locale per una prenotazione già presa in carico (§10). */
export class ProposeTimeChangeDto {
  @IsISO8601()
  reservedAt: string;
}
