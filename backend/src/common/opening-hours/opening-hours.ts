/**
 * Orari di apertura settimanali di un locale (§5.4/§5.7 di
 * DEVELOPMENT.md), condivisi tra il menù pubblico (voci "solo
 * pranzo"/"solo cena") e il modulo Prenotazioni (validazione orario
 * richiesto). Salvati come JSON su `Venue.openingHours`.
 */
export interface OpeningHoursDay {
  /** 0 = domenica .. 6 = sabato, come Date#getDay(). */
  dayOfWeek: number;
  closed: boolean;
  /** "HH:mm". Prima fascia (es. pranzo). */
  slot1Start: string | null;
  slot1End: string | null;
  /** Seconda fascia opzionale (es. cena, con una pausa rispetto alla prima). */
  slot2Start: string | null;
  slot2End: string | null;
}

/** Default storico se il locale non ha ancora configurato i propri orari: aperto tutti i giorni, pranzo + cena. */
export const DEFAULT_OPENING_HOURS: OpeningHoursDay[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  closed: false,
  slot1Start: '12:00',
  slot1End: '15:00',
  slot2Start: '19:00',
  slot2End: '23:00',
}));

/** Orario configurato dal locale (7 giorni), oppure il default se non ancora impostato. */
export function resolveOpeningHours(raw: unknown): OpeningHoursDay[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_OPENING_HOURS;
  const byDay = new Map<number, OpeningHoursDay>();
  for (const entry of raw as OpeningHoursDay[]) {
    if (entry && typeof entry.dayOfWeek === 'number') byDay.set(entry.dayOfWeek, entry);
  }
  return DEFAULT_OPENING_HOURS.map((fallback) => byDay.get(fallback.dayOfWeek) ?? fallback);
}

/** Sovrascrittura di un giorno per una data specifica (VenueSpecialDay.realHoursOverride/menuHoursOverride), senza "dayOfWeek". */
export type DayOverride = Omit<OpeningHoursDay, 'dayOfWeek'>;

/**
 * "YYYY-MM-DD" (nel fuso del locale) -> chiave di data usata per
 * VenueSpecialDay.date (mezzanotte UTC di quel calendario, non
 * un istante reale: è solo una chiave di lookup, mai confrontata come
 * orario). Scrittura e lettura devono sempre passare da qui per restare
 * consistenti.
 */
export function specialDayKey(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * Il giorno della settimana risolto dallo schedule normale, sostituito per
 * intero da "override" quando presente (una VenueSpecialDay, §5.10): non è
 * un merge campo per campo, l'override porta sempre tutti i 5 campi.
 */
export function applyDayOverride(day: OpeningHoursDay, override: DayOverride | null | undefined): OpeningHoursDay {
  return override ? { dayOfWeek: day.dayOfWeek, ...override } : day;
}

/** "HH:mm" -> minuti dalla mezzanotte, es. "14:30" -> 870. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Inverso di hhmmToMinutes: minuti dalla mezzanotte -> "HH:mm". */
export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const toMinutes = hhmmToMinutes;

/** In quale fascia (1 o 2) cade l'orario dato per quel giorno, o null se chiuso/fuori orario. */
export function findOpenSlot(day: OpeningHoursDay, minutesOfDay: number): 1 | 2 | null {
  if (day.closed) return null;
  if (
    day.slot1Start &&
    day.slot1End &&
    minutesOfDay >= toMinutes(day.slot1Start) &&
    minutesOfDay <= toMinutes(day.slot1End)
  ) {
    return 1;
  }
  if (
    day.slot2Start &&
    day.slot2End &&
    minutesOfDay >= toMinutes(day.slot2Start) &&
    minutesOfDay <= toMinutes(day.slot2End)
  ) {
    return 2;
  }
  return null;
}

/**
 * Come findOpenSlot, ma per gli ordini online (§5.10 di DEVELOPMENT.md):
 * il primo orario richiedibile è l'inizio fascia +marginMinutes e l'ultimo
 * è la fine fascia -marginMinutes (es. cucina 12:00-15:00 con margine 30 =
 * richiedibile solo 12:30-14:30) — un margine fisso di tempo di
 * preparazione che le Prenotazioni non hanno. Una fascia troppo corta per
 * il margine (es. 15 minuti totali con margine 30) risulta semplicemente
 * sempre chiusa per gli ordini online, senza errori.
 */
export function findOpenSlotWithMargin(
  day: OpeningHoursDay,
  minutesOfDay: number,
  marginMinutes: number,
): 1 | 2 | null {
  if (day.closed) return null;
  if (
    day.slot1Start &&
    day.slot1End &&
    minutesOfDay >= toMinutes(day.slot1Start) + marginMinutes &&
    minutesOfDay <= toMinutes(day.slot1End) - marginMinutes
  ) {
    return 1;
  }
  if (
    day.slot2Start &&
    day.slot2End &&
    minutesOfDay >= toMinutes(day.slot2Start) + marginMinutes &&
    minutesOfDay <= toMinutes(day.slot2End) - marginMinutes
  ) {
    return 2;
  }
  return null;
}
