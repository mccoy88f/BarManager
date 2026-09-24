import { HaccpService } from './haccp.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

describe('HaccpService.listReadings — intervallo date nel fuso orario del locale', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    temperatureReading: { findMany: jest.Mock };
  };
  let service: HaccpService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Rome' }) },
      temperatureReading: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new HaccpService(prisma as unknown as PrismaService, { log: jest.fn() } as unknown as AuditService);
  });

  it('estende "to" a fine giornata nel fuso del locale, non a mezzanotte UTC', async () => {
    await service.listReadings('venue-1', '2026-10-01', '2026-10-01');

    expect(prisma.temperatureReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: {
            gte: new Date('2026-09-30T22:00:00.000Z'), // 2026-10-01 00:00 CEST
            lte: new Date('2026-10-01T21:59:59.999Z'), // 2026-10-01 23:59:59.999 CEST
          },
        }),
      }),
    );
  });

  it('senza "from"/"to" non applica alcun filtro di data', async () => {
    await service.listReadings('venue-1');

    expect(prisma.temperatureReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ recordedAt: { gte: undefined, lte: undefined } }) }),
    );
  });
});

describe("HaccpService.resolveSignerName — chi firma è chi ha fatto login, non va chiesto", () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let service: HaccpService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    service = new HaccpService(prisma as unknown as PrismaService, { log: jest.fn() } as unknown as AuditService);
  });

  it("usa nome e cognome se l'account ha una scheda Employee collegata", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'mario@venue1.test',
      employee: { firstName: 'Mario', lastName: 'Rossi' },
    });

    await expect(service.resolveSignerName('user-1')).resolves.toBe('Mario Rossi');
  });

  it("usa l'email di login se l'account non ha una scheda Employee (es. un Admin puro)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@venue1.test',
      employee: null,
    });

    await expect(service.resolveSignerName('admin-1')).resolves.toBe('admin@venue1.test');
  });

  it('rifiuta se lo userId non corrisponde a nessun utente', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.resolveSignerName('inesistente')).rejects.toThrow();
  });
});
