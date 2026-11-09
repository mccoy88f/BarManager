import { LoyverseSyncSchedulerService } from './loyverse-sync-scheduler.service';
import { LoyverseSyncService } from './loyverse-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { DateTime } from 'luxon';

describe('LoyverseSyncSchedulerService', () => {
  let prisma: { venue: { findMany: jest.Mock } };
  let syncService: { sync: jest.Mock };
  let scheduler: LoyverseSyncSchedulerService;

  beforeEach(() => {
    prisma = { venue: { findMany: jest.fn() } };
    syncService = { sync: jest.fn() };
    scheduler = new LoyverseSyncSchedulerService(
      prisma as unknown as PrismaService,
      syncService as unknown as LoyverseSyncService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sincronizza i locali con integrazione attiva alle 06:00 nel loro fuso', async () => {
    const atSixRome = DateTime.fromObject(
      { year: 2026, month: 11, day: 9, hour: 6, minute: 0 },
      { zone: 'Europe/Rome' },
    ).toJSDate();
    jest.useFakeTimers({ now: atSixRome });

    prisma.venue.findMany.mockResolvedValue([
      { id: 'v1', name: 'Bar Roma', timezone: 'Europe/Rome' },
      { id: 'v2', name: 'Bar UTC', timezone: 'UTC' },
    ]);
    syncService.sync.mockResolvedValue({ categories: 1, items: 2 });

    await scheduler.tick();

    expect(syncService.sync).toHaveBeenCalledTimes(1);
    expect(syncService.sync).toHaveBeenCalledWith('v1');
  });

  it('sincronizza anche alle 18:00 locali', async () => {
    const atEighteenRome = DateTime.fromObject(
      { year: 2026, month: 11, day: 9, hour: 18, minute: 0 },
      { zone: 'Europe/Rome' },
    ).toJSDate();
    jest.useFakeTimers({ now: atEighteenRome });

    prisma.venue.findMany.mockResolvedValue([{ id: 'v1', name: 'Bar Roma', timezone: 'Europe/Rome' }]);
    syncService.sync.mockResolvedValue({ categories: 0, items: 0 });

    await scheduler.tick();

    expect(syncService.sync).toHaveBeenCalledWith('v1');
  });

  it('non sincronizza fuori dagli orari previsti', async () => {
    const atNoonRome = DateTime.fromObject(
      { year: 2026, month: 11, day: 9, hour: 12, minute: 0 },
      { zone: 'Europe/Rome' },
    ).toJSDate();
    jest.useFakeTimers({ now: atNoonRome });

    prisma.venue.findMany.mockResolvedValue([{ id: 'v1', name: 'Bar Roma', timezone: 'Europe/Rome' }]);

    await scheduler.tick();

    expect(syncService.sync).not.toHaveBeenCalled();
  });

  it('continua con gli altri locali se uno fallisce', async () => {
    const atSixRome = DateTime.fromObject(
      { year: 2026, month: 11, day: 9, hour: 6, minute: 0 },
      { zone: 'Europe/Rome' },
    ).toJSDate();
    jest.useFakeTimers({ now: atSixRome });

    prisma.venue.findMany.mockResolvedValue([
      { id: 'v1', name: 'Bar A', timezone: 'Europe/Rome' },
      { id: 'v2', name: 'Bar B', timezone: 'Europe/Rome' },
    ]);
    syncService.sync.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ categories: 1, items: 1 });

    await scheduler.tick();

    expect(syncService.sync).toHaveBeenCalledTimes(2);
    expect(syncService.sync).toHaveBeenNthCalledWith(1, 'v1');
    expect(syncService.sync).toHaveBeenNthCalledWith(2, 'v2');
  });
});
