import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService.getAdminSummary — fornitori da ordinare oggi nel fuso del locale', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    leaveRequest: { findMany: jest.Mock };
    notification: { findMany: jest.Mock };
    supplier: { findMany: jest.Mock };
    task: { findMany: jest.Mock };
  };
  let service: DashboardService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn() },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new DashboardService(prisma as unknown as PrismaService);
    // Giovedì 15 gennaio 2026 23:30 UTC (ISO weekday 4) è già venerdì
    // (ISO weekday 5) a Roma.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T23:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calcola il giorno della settimana dei fornitori da ordinare nel fuso orario del locale, non del server', async () => {
    prisma.venue.findUnique.mockResolvedValue({ timezone: 'Europe/Rome' });

    await service.getAdminSummary('venue-1', 'user-1');

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderDays: { has: 5 } }) }),
    );
  });
});
