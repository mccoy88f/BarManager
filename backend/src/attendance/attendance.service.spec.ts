import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AttendanceSource, AttendanceType } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'dipendente@venue1.test',
  role: 'EMPLOYEE',
  venueId: 'venue-1',
};

// Locale: 45.0, 9.0 (Milano-ish), raggio 20m.
const VENUE_LAT = 45.0;
const VENUE_LNG = 9.0;

function baseVenueSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clockInQrEnabled: false,
    clockInGpsEnabled: false,
    clockInNfcEnabled: false,
    gpsLat: VENUE_LAT,
    gpsLng: VENUE_LNG,
    gpsRadiusMeters: 20,
    ...overrides,
  };
}

describe('AttendanceService.clock', () => {
  let prisma: {
    venue: { findUniqueOrThrow: jest.Mock };
    employee: { findUnique: jest.Mock };
    attendanceRecord: { findFirst: jest.Mock; create: jest.Mock };
    qrToken: { findUnique: jest.Mock };
    nfcTag: { findUnique: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let service: AttendanceService;

  beforeEach(() => {
    prisma = {
      venue: { findUniqueOrThrow: jest.fn() },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'employee-1' }) },
      attendanceRecord: {
        findFirst: jest.fn().mockResolvedValue(null), // nessuna timbratura precedente -> CLOCK_IN
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'record-1', ...data })),
      },
      qrToken: { findUnique: jest.fn() },
      nfcTag: { findUnique: jest.fn() },
    };
    audit = { log: jest.fn() };
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('GPS', () => {
    it('accetta la timbratura entro il raggio configurato', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInGpsEnabled: true }));
      // ~10m a nord del punto del locale, entro il raggio di 20m.
      const record = await service.clock(user, { gpsLat: VENUE_LAT + 0.00009, gpsLng: VENUE_LNG });
      expect(record.source).toBe(AttendanceSource.GPS);
      expect(record.type).toBe(AttendanceType.CLOCK_IN);
    });

    it('rifiuta la timbratura fuori dal raggio configurato', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInGpsEnabled: true }));
      // ~1.1km a nord: ben oltre i 20m di raggio.
      await expect(
        service.clock(user, { gpsLat: VENUE_LAT + 0.01, gpsLng: VENUE_LNG }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });

    it('rifiuta il GPS se il metodo non è abilitato per il locale', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInGpsEnabled: false }));
      await expect(
        service.clock(user, { gpsLat: VENUE_LAT, gpsLng: VENUE_LNG }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rifiuta il GPS se il locale non ha ancora impostato la posizione', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(
        baseVenueSettings({ clockInGpsEnabled: true, gpsLat: null, gpsLng: null }),
      );
      await expect(
        service.clock(user, { gpsLat: VENUE_LAT, gpsLng: VENUE_LNG }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('NFC', () => {
    it('accetta un tag NFC valido del locale', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInNfcEnabled: true }));
      prisma.nfcTag.findUnique.mockResolvedValue({ id: 'tag-1', active: true, venueId: 'venue-1' });
      const record = await service.clock(user, { nfcValue: 'INGRESSO-CUCINA' });
      expect(record.source).toBe(AttendanceSource.NFC);
      expect(record.nfcTagId).toBe('tag-1');
    });

    it('rifiuta un tag NFC sconosciuto', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInNfcEnabled: true }));
      prisma.nfcTag.findUnique.mockResolvedValue(null);
      await expect(service.clock(user, { nfcValue: 'testo-a-caso' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rifiuta un tag NFC di un altro locale', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInNfcEnabled: true }));
      prisma.nfcTag.findUnique.mockResolvedValue({ id: 'tag-2', active: true, venueId: 'venue-2' });
      await expect(service.clock(user, { nfcValue: 'testo-altro-locale' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rifiuta l\'NFC se il metodo non è abilitato per il locale', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInNfcEnabled: false }));
      await expect(service.clock(user, { nfcValue: 'qualsiasi' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.nfcTag.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('QR', () => {
    it('rifiuta il QR se il metodo non è abilitato per il locale', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInQrEnabled: false }));
      await expect(service.clock(user, { qrToken: 'abc123' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.qrToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('nessun metodo fornito', () => {
    it('permette la timbratura diretta (MANUAL) se il locale non ha abilitato nulla', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings());
      const record = await service.clock(user, {});
      expect(record.source).toBe(AttendanceSource.MANUAL);
    });

    it('rifiuta la timbratura diretta se il locale ha abilitato almeno un metodo verificato', async () => {
      prisma.venue.findUniqueOrThrow.mockResolvedValue(baseVenueSettings({ clockInQrEnabled: true }));
      await expect(service.clock(user, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    });
  });
});
