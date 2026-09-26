import {
  DEFAULT_OPENING_HOURS,
  findOpenSlot,
  findOpenSlotWithMargin,
  hhmmToMinutes,
  isTimeInSlot,
  minutesToHhmm,
  resolveOpeningHours,
  type OpeningHoursDay,
} from './opening-hours';

describe('common/opening-hours', () => {
  describe('hhmmToMinutes and minutesToHhmm', () => {
    it('converte correttamente minuti e stringhe HH:mm', () => {
      expect(hhmmToMinutes('00:00')).toBe(0);
      expect(hhmmToMinutes('08:00')).toBe(480);
      expect(hhmmToMinutes('17:46')).toBe(17 * 60 + 46);
      expect(minutesToHhmm(480)).toBe('08:00');
      expect(minutesToHhmm(17 * 60 + 46)).toBe('17:46');
    });
  });

  describe('isTimeInSlot', () => {
    it('gestisce fasce regolari durante il giorno', () => {
      // 12:00 (720) - 15:00 (900)
      expect(isTimeInSlot('12:00', '15:00', 719)).toBe(false);
      expect(isTimeInSlot('12:00', '15:00', 720)).toBe(true);
      expect(isTimeInSlot('12:00', '15:00', 800)).toBe(true);
      expect(isTimeInSlot('12:00', '15:00', 900)).toBe(true);
      expect(isTimeInSlot('12:00', '15:00', 901)).toBe(false);
    });

    it('gestisce correttamente chiusura a mezzanotte (00:00)', () => {
      // Locale aperto dalle 17:00 a mezzanotte (00:00)
      // 17:00 = 1020, 17:46 = 1066, 23:45 = 1425, 24:00 = 1440
      expect(isTimeInSlot('17:00', '00:00', 1019)).toBe(false);
      expect(isTimeInSlot('17:00', '00:00', 1020)).toBe(true);
      expect(isTimeInSlot('17:00', '00:00', 1066)).toBe(true); // 17:46 — l'orario segnalato dall'utente!
      expect(isTimeInSlot('17:00', '00:00', 1425)).toBe(true); // 23:45
      expect(isTimeInSlot('17:00', '00:00', 1440)).toBe(true); // 24:00
      expect(isTimeInSlot('17:00', '00:00', 500)).toBe(false); // mattina
    });

    it('gestisce fasce che scavallano la mezzanotte (es. 18:00 - 02:00)', () => {
      // 18:00 (1080) - 02:00 (120)
      expect(isTimeInSlot('18:00', '02:00', 1079)).toBe(false);
      expect(isTimeInSlot('18:00', '02:00', 1080)).toBe(true);
      expect(isTimeInSlot('18:00', '02:00', 1400)).toBe(true);
      expect(isTimeInSlot('18:00', '02:00', 60)).toBe(true); // 01:00
      expect(isTimeInSlot('18:00', '02:00', 120)).toBe(true); // 02:00
      expect(isTimeInSlot('18:00', '02:00', 121)).toBe(false); // 02:01
      expect(isTimeInSlot('18:00', '02:00', 600)).toBe(false); // 10:00
    });
  });

  describe('findOpenSlot', () => {
    it('trova la fascia corretta anche se chiude a 00:00', () => {
      const saturday: OpeningHoursDay = {
        dayOfWeek: 6,
        closed: false,
        slot1Start: '08:00',
        slot1End: '14:00',
        slot2Start: '17:00',
        slot2End: '00:00',
      };

      // 17:46 di sabato: deve restituire la fascia 2!
      const userMinutes = 17 * 60 + 46;
      expect(findOpenSlot(saturday, userMinutes)).toBe(2);

      // Fuori orario (pausa pomeridiana 15:30)
      expect(findOpenSlot(saturday, 15 * 60 + 30)).toBe(null);
    });

    it('restituisce null se il giorno è chiuso', () => {
      const sunday: OpeningHoursDay = {
        dayOfWeek: 0,
        closed: true,
        slot1Start: '12:00',
        slot1End: '15:00',
        slot2Start: null,
        slot2End: null,
      };
      expect(findOpenSlot(sunday, 13 * 60)).toBe(null);
    });
  });
});
