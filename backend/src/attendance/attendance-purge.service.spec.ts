import { AttendancePurgeService } from './attendance-purge.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AttendancePurgeService', () => {
  let prisma: {
    venue: { findMany: jest.Mock };
    attendanceRecord: { deleteMany: jest.Mock };
  };
  let service: AttendancePurgeService;

  beforeEach(() => {
    prisma = {
      venue: { findMany: jest.fn().mockResolvedValue([]) },
      attendanceRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    service = new AttendancePurgeService(prisma as unknown as PrismaService);
  });

  it('non interroga le presenze se nessun locale ha una soglia impostata', async () => {
    await service.purgeOldRecords();
    expect(prisma.attendanceRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('cancella le presenze più vecchie della soglia in giorni per il locale', async () => {
    prisma.venue.findMany.mockResolvedValue([
      { id: 'venue-1', attendanceRetentionValue: 30, attendanceRetentionUnit: 'DAYS' },
    ]);
    const before = Date.now();

    await service.purgeOldRecords();

    expect(prisma.attendanceRecord.deleteMany).toHaveBeenCalledTimes(1);
    const call = prisma.attendanceRecord.deleteMany.mock.calls[0][0];
    expect(call.where.employee).toEqual({ venueId: 'venue-1' });
    const cutoff = call.where.timestamp.lt as Date;
    const expectedMs = before - 30 * 24 * 60 * 60 * 1000;
    // Tolleranza di qualche secondo per il tempo di esecuzione del test.
    expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5000);
  });

  it('applica la soglia corretta per più locali con unità diverse', async () => {
    prisma.venue.findMany.mockResolvedValue([
      { id: 'venue-1', attendanceRetentionValue: 6, attendanceRetentionUnit: 'MONTHS' },
      { id: 'venue-2', attendanceRetentionValue: 2, attendanceRetentionUnit: 'YEARS' },
    ]);

    await service.purgeOldRecords();

    expect(prisma.attendanceRecord.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.attendanceRecord.deleteMany.mock.calls[0][0].where.employee).toEqual({
      venueId: 'venue-1',
    });
    expect(prisma.attendanceRecord.deleteMany.mock.calls[1][0].where.employee).toEqual({
      venueId: 'venue-2',
    });
  });
});
