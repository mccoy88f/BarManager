import { DateTime } from 'luxon';

/**
 * Ogni calcolo di "oggi"/giorno della settimana/orario riferito a un
 * locale (validazione prenotazioni, fascia pranzo/cena del menù, fornitori
 * da ordinare oggi, periodo corrente delle pulizie HACCP, range data dei
 * report HACCP) deve usare il fuso orario del locale (`Venue.timezone`),
 * non quello del processo Node (in produzione tipicamente UTC, comunque
 * indipendente dal locale). Queste funzioni sono l'unico punto che
 * interpreta un istante (`Date`) nel fuso di un locale specifico.
 */

const DEFAULT_TIMEZONE = 'Europe/Rome';

/** `Venue.timezone` può essere assente su righe più vecchie del campo (letture dirette senza passare da Prisma migrate/default) — fallback esplicito. */
function zoneOrDefault(timezone: string | null | undefined): string {
  return timezone || DEFAULT_TIMEZONE;
}

/** Giorno della settimana nel fuso del locale, convenzione `Date#getDay()` (0=domenica..6=sabato), usata da `Venue.openingHours`. */
export function jsWeekdayInZone(at: Date, timezone: string | null | undefined): number {
  const dt = DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) });
  return dt.weekday % 7; // luxon: 1=lunedì..7=domenica -> %7 fa diventare domenica 0, invariati gli altri.
}

/** Giorno della settimana nel fuso del locale, convenzione ISO (1=lunedì..7=domenica), usata da `Supplier.orderDays`. */
export function isoWeekdayInZone(at: Date, timezone: string | null | undefined): number {
  return DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) }).weekday;
}

/** Minuti dalla mezzanotte (0-1439) nel fuso del locale, per confrontare con le fasce orarie di `Venue.openingHours`. */
export function minutesOfDayInZone(at: Date, timezone: string | null | undefined): number {
  const dt = DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) });
  return dt.hour * 60 + dt.minute;
}

/** Istante corrispondente alla mezzanotte locale del locale, per il giorno di `at`. */
export function startOfDayInZone(at: Date, timezone: string | null | undefined): Date {
  return DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) }).startOf('day').toJSDate();
}

/** Istante corrispondente all'ultimo istante del giorno locale del locale (23:59:59.999). */
export function endOfDayInZone(at: Date, timezone: string | null | undefined): Date {
  return DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) }).endOf('day').toJSDate();
}

/** Inizio della settimana ISO (lunedì, mezzanotte) nel fuso del locale, per il giorno di `at`. */
export function startOfIsoWeekInZone(at: Date, timezone: string | null | undefined): Date {
  return DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) })
    .set({ weekday: 1 })
    .startOf('day')
    .toJSDate();
}

/** Inizio del mese (giorno 1, mezzanotte) nel fuso del locale, per il giorno di `at`. */
export function startOfMonthInZone(at: Date, timezone: string | null | undefined): Date {
  return DateTime.fromJSDate(at, { zone: zoneOrDefault(timezone) }).startOf('month').toJSDate();
}

/**
 * Interpreta una stringa data-sola (`"2026-10-01"`, dal frontend) come la
 * mezzanotte di quel giorno nel fuso del locale — non nel fuso del server
 * (che `new Date("2026-10-01")` userebbe implicitamente, sempre UTC per le
 * stringhe in questo formato secondo lo standard ISO 8601/JS).
 */
export function parseDateOnlyStartOfDayInZone(dateOnly: string, timezone: string | null | undefined): Date {
  return DateTime.fromISO(dateOnly, { zone: zoneOrDefault(timezone) }).startOf('day').toJSDate();
}

/** Come sopra, ma l'ultimo istante di quel giorno (23:59:59.999) nel fuso del locale — per il limite superiore ("to") di un intervallo di date. */
export function parseDateOnlyEndOfDayInZone(dateOnly: string, timezone: string | null | undefined): Date {
  return DateTime.fromISO(dateOnly, { zone: zoneOrDefault(timezone) }).endOf('day').toJSDate();
}
