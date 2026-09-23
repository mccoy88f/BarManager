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

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

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

/** Il locale è aperto nel giorno/orario dato? Usa l'ora locale del server (nessuna gestione fuso per-locale, rifinitura futura). */
export function isOpenAt(schedule: OpeningHoursDay[], at: Date): boolean {
  const day = schedule.find((d) => d.dayOfWeek === at.getDay()) ?? DEFAULT_OPENING_HOURS[at.getDay()];
  const minutesOfDay = at.getHours() * 60 + at.getMinutes();
  return findOpenSlot(day, minutesOfDay) !== null;
}
