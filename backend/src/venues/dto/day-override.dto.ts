import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyToNull = ({ value }: { value: string }) => (value === '' ? null : value);

/**
 * Sovrascrittura di orario per una singola data (§5.10 di DEVELOPMENT.md):
 * stessa forma di OpeningHoursDayDto ma senza "dayOfWeek", perché la
 * sovrascrittura è già legata a una data specifica (v. UpsertSpecialDayDto).
 */
export class DayOverrideDto {
  @IsBoolean()
  closed: boolean;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot1Start deve avere formato HH:mm' })
  slot1Start?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot1End deve avere formato HH:mm' })
  slot1End?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot2Start deve avere formato HH:mm' })
  slot2Start?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot2End deve avere formato HH:mm' })
  slot2End?: string | null;
}
