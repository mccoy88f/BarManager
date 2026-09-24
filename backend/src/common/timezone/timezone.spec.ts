import {
  endOfDayInZone,
  isoWeekdayInZone,
  jsWeekdayInZone,
  minutesOfDayInZone,
  parseDateOnlyEndOfDayInZone,
  parseDateOnlyStartOfDayInZone,
  startOfDayInZone,
  startOfIsoWeekInZone,
  startOfMonthInZone,
} from './timezone';

describe('common/timezone', () => {
  // 2026-01-15 23:30 UTC = 2026-01-16 00:30 a Roma (UTC+1 d'inverno, niente DST)
  // = 2026-01-15 15:30 a Los Angeles (UTC-8 d'inverno).
  const winterInstant = new Date('2026-01-15T23:30:00.000Z');

  describe('jsWeekdayInZone / isoWeekdayInZone', () => {
    it('lo stesso istante può cadere in un giorno della settimana diverso secondo il fuso del locale', () => {
      // Giovedì 15 gennaio 2026 UTC (getDay JS: 4) diventa venerdì 16 a Roma.
      expect(jsWeekdayInZone(winterInstant, 'Europe/Rome')).toBe(5); // venerdì
      expect(jsWeekdayInZone(winterInstant, 'America/Los_Angeles')).toBe(4); // ancora giovedì
      expect(isoWeekdayInZone(winterInstant, 'Europe/Rome')).toBe(5); // ISO: 5=venerdì
      expect(isoWeekdayInZone(winterInstant, 'America/Los_Angeles')).toBe(4); // ISO: 4=giovedì
    });

    it('usa Europe/Rome come fallback se il fuso non è impostato (righe precedenti al campo)', () => {
      expect(jsWeekdayInZone(winterInstant, null)).toBe(jsWeekdayInZone(winterInstant, 'Europe/Rome'));
      expect(jsWeekdayInZone(winterInstant, undefined)).toBe(jsWeekdayInZone(winterInstant, 'Europe/Rome'));
    });
  });

  describe('minutesOfDayInZone', () => {
    it("calcola i minuti dalla mezzanotte nell'orario locale del fuso, non in UTC", () => {
      expect(minutesOfDayInZone(winterInstant, 'Europe/Rome')).toBe(30); // 00:30
      expect(minutesOfDayInZone(winterInstant, 'America/Los_Angeles')).toBe(15 * 60 + 30); // 15:30
    });
  });

  describe('startOfDayInZone / endOfDayInZone', () => {
    it('la mezzanotte locale di un fuso è un istante diverso da quella di un altro fuso, per lo stesso giorno', () => {
      const romeMidnight = startOfDayInZone(winterInstant, 'Europe/Rome');
      const laMidnight = startOfDayInZone(winterInstant, 'America/Los_Angeles');
      expect(romeMidnight.toISOString()).toBe('2026-01-15T23:00:00.000Z'); // 2026-01-16 00:00 CET
      expect(laMidnight.toISOString()).toBe('2026-01-15T08:00:00.000Z'); // 2026-01-15 00:00 PST
      expect(romeMidnight.getTime()).not.toBe(laMidnight.getTime());
    });

    it("l'ultimo istante del giorno locale è il giorno dopo meno un millisecondo", () => {
      const romeEnd = endOfDayInZone(winterInstant, 'Europe/Rome');
      expect(romeEnd.toISOString()).toBe('2026-01-16T22:59:59.999Z'); // 2026-01-16 23:59:59.999 CET
    });
  });

  describe('startOfIsoWeekInZone', () => {
    it('trova il lunedì della settimana ISO corrente nel fuso del locale', () => {
      // 16 gennaio 2026 è venerdì a Roma -> lunedì di quella settimana è il 12.
      const start = startOfIsoWeekInZone(winterInstant, 'Europe/Rome');
      expect(start.toISOString()).toBe('2026-01-11T23:00:00.000Z'); // 2026-01-12 00:00 CET
    });
  });

  describe('startOfMonthInZone', () => {
    it('trova il primo giorno del mese nel fuso del locale', () => {
      const start = startOfMonthInZone(winterInstant, 'Europe/Rome');
      expect(start.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // 2026-01-01 00:00 CET
    });
  });

  describe('parseDateOnlyStartOfDayInZone / parseDateOnlyEndOfDayInZone', () => {
    it('interpreta una stringa data-sola come mezzanotte nel fuso del locale, non in UTC', () => {
      const start = parseDateOnlyStartOfDayInZone('2026-10-01', 'Europe/Rome');
      // new Date('2026-10-01') darebbe 2026-10-01T00:00:00.000Z (UTC): qui invece
      // deve essere 2026-10-01 00:00 CEST (UTC+2, ora legale ancora attiva).
      expect(start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    });

    it('estende a fine giornata nel fuso del locale (per il limite superiore "to" di un intervallo)', () => {
      const end = parseDateOnlyEndOfDayInZone('2026-10-01', 'Europe/Rome');
      expect(end.toISOString()).toBe('2026-10-01T21:59:59.999Z');
    });

    it('fusi diversi danno istanti diversi per la stessa stringa data', () => {
      const romeStart = parseDateOnlyStartOfDayInZone('2026-10-01', 'Europe/Rome');
      const laStart = parseDateOnlyStartOfDayInZone('2026-10-01', 'America/Los_Angeles');
      expect(romeStart.getTime()).not.toBe(laStart.getTime());
    });
  });
});
