import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyToNull = ({ value }: { value: string }) => (value === '' ? null : value);

export class OpeningHoursDayDto {
  /** 0 = domenica .. 6 = sabato, come Date#getDay(). */
  @IsInt()
  @IsIn([0, 1, 2, 3, 4, 5, 6])
  dayOfWeek: number;

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

  /** Seconda fascia opzionale (es. cena, con una pausa rispetto alla prima). */
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot2Start deve avere formato HH:mm' })
  slot2Start?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @Matches(HHMM, { message: 'slot2End deve avere formato HH:mm' })
  slot2End?: string | null;
}
