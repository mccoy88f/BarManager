import type { OpeningHoursDay } from '../components/OpeningHoursWeekEditor';

/** Sovrascrittura di un solo giorno, senza dayOfWeek (VenueSpecialDay). */
export interface DayOverride {
  closed: boolean;
  slot1Start: string | null;
  slot1End: string | null;
  slot2Start: string | null;
  slot2End: string | null;
}

/** Data "YYYY-MM-DD" e, se presente, l'orario reale che sostituisce quello settimanale. */
export interface SpecialDaySchedule {
  date: string;
  realHoursOverride: DayOverride | null;
}

/**
 * Orario del giorno scelto: lo schedule settimanale, sostituito per intero
 * da un'apertura o una chiusura speciale di quella data.
 */
export function scheduleForDate(
  openingHours: OpeningHoursDay[],
  specialDays: SpecialDaySchedule[] | undefined,
  date: string,
): OpeningHoursDay | undefined {
  const base = openingHours.find((d) => d.dayOfWeek === new Date(`${date}T00:00:00`).getDay());
  if (!base) return undefined;
  const special = specialDays?.find((day) => day.date.slice(0, 10) === date);
  if (!special?.realHoursOverride) return base;
  return { dayOfWeek: base.dayOfWeek, ...special.realHoursOverride };
}
