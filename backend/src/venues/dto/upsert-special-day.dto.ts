import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { DayOverrideDto } from './day-override.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Apertura/chiusura straordinaria per una data (§5.10 di DEVELOPMENT.md). */
export class UpsertSpecialDayDto {
  /** "YYYY-MM-DD", nel fuso del locale. */
  @Matches(DATE_ONLY, { message: 'date deve avere formato YYYY-MM-DD' })
  date: string;

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DayOverrideDto)
  realHoursOverride?: DayOverrideDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DayOverrideDto)
  menuHoursOverride?: DayOverrideDto | null;
}
