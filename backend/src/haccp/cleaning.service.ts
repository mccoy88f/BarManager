import { Injectable, NotFoundException } from '@nestjs/common';
import { CleaningFrequencyUnit } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { parseDateOnlyEndOfDayInZone, parseDateOnlyStartOfDayInZone } from '../common/timezone/timezone';
import { CreateCleaningTaskDto } from './dto/create-cleaning-task.dto';
import { UpdateCleaningTaskDto } from './dto/update-cleaning-task.dto';

/**
 * Inizio/fine (esclusa) del periodo corrente per una ricorrenza di pulizia,
 * nel fuso orario del locale — usa direttamente Luxon (`.plus`) per il
 * calcolo del confine superiore invece di manipolare a mano lo `Date` UTC
 * risultante (es. `setUTCDate(+1)`), che su un cambio ora legale proprio a
 * cavallo della mezzanotte locale non atterrerebbe esattamente sulla
 * mezzanotte del giorno dopo.
 */
function periodRange(unit: CleaningFrequencyUnit, timezone: string | null | undefined): { start: Date; end: Date } {
  const zone = timezone || 'Europe/Rome';
  const now = DateTime.fromJSDate(new Date(), { zone });
  if (unit === CleaningFrequencyUnit.DAY) {
    const start = now.startOf('day');
    return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
  }
  if (unit === CleaningFrequencyUnit.WEEK) {
    const start = now.set({ weekday: 1 }).startOf('day');
    return { start: start.toJSDate(), end: start.plus({ weeks: 1 }).toJSDate() };
  }
  const start = now.startOf('month');
  return { start: start.toJSDate(), end: start.plus({ months: 1 }).toJSDate() };
}

/**
 * Pulizie HACCP: voci ricorrenti (es. "Sgrassare friggitrice" in "Cucina",
 * ogni giorno) censite dall'admin, che i dipendenti segnano come fatte nel
 * periodo corrente (giorno/settimana/mese). CleaningLog traccia chi e quando.
 */
@Injectable()
export class CleaningService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  createTask(venueId: string, dto: CreateCleaningTaskDto) {
    return this.prisma.cleaningTask.create({
      data: {
        description: dto.description,
        location: dto.location,
        frequencyUnit: dto.frequencyUnit,
        timesPerUnit: dto.timesPerUnit ?? 1,
        venueId,
      },
    });
  }

  listTasks(venueId: string) {
    return this.prisma.cleaningTask.findMany({
      where: { venueId, active: true },
      orderBy: [{ location: 'asc' }, { description: 'asc' }],
    });
  }

  async updateTask(venueId: string, id: string, dto: UpdateCleaningTaskDto) {
    const task = await this.prisma.cleaningTask.findUnique({ where: { id } });
    if (!task || task.venueId !== venueId) {
      throw new NotFoundException('Voce di pulizia non trovata');
    }
    return this.prisma.cleaningTask.update({ where: { id }, data: dto });
  }

  /** Disattiva la voce senza perdere lo storico di chi l'ha già svolta (CleaningLog). */
  async removeTask(venueId: string, id: string) {
    const task = await this.prisma.cleaningTask.findUnique({ where: { id } });
    if (!task || task.venueId !== venueId) {
      throw new NotFoundException('Voce di pulizia non trovata');
    }
    await this.prisma.cleaningTask.update({ where: { id }, data: { active: false } });
    return { success: true };
  }

  /** Voci del periodo corrente, con quante volte sono già state fatte oggi/questa settimana/questo mese. */
  async listDueToday(venueId: string) {
    const [tasks, venue] = await Promise.all([
      this.listTasks(venueId),
      this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } }),
    ]);
    return Promise.all(
      tasks.map(async (task) => {
        const { start, end } = periodRange(task.frequencyUnit, venue?.timezone);
        const completedInPeriod = await this.prisma.cleaningLog.count({
          where: { taskId: task.id, completedAt: { gte: start, lt: end } },
        });
        return {
          ...task,
          completedInPeriod,
          remaining: Math.max(0, task.timesPerUnit - completedInPeriod),
        };
      }),
    );
  }

  /**
   * Chi chiama segna la voce come fatta ora. Come per le letture temperature
   * (TemperatureReading.recordedBy), l'esecuzione è sempre tracciata sullo
   * User: l'Employee, quando c'è, serve solo a mostrare nome e cognome.
   * Admin e responsabili senza una scheda dipendente possono quindi
   * segnare comunque una pulizia come fatta.
   */
  async complete(user: AuthenticatedUser, taskId: string) {
    const venueId = requireVenueId(user);
    const task = await this.prisma.cleaningTask.findUnique({ where: { id: taskId } });
    if (!task || task.venueId !== venueId) {
      throw new NotFoundException('Voce di pulizia non trovata');
    }

    const employee = await this.prisma.employee.findUnique({ where: { userId: user.userId } });

    const log = await this.prisma.cleaningLog.create({
      data: { taskId, employeeId: employee?.id, userId: user.userId },
      include: {
        task: true,
        employee: { select: { firstName: true, lastName: true } },
        user: { select: { email: true } },
      },
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'CleaningLog',
      entityId: log.id,
      action: 'CREATE',
      after: log,
    });

    return log;
  }

  /** Storico di chi ha pulito cosa e quando, per l'admin. */
  async listLogs(venueId: string, from?: string, to?: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } });

    return this.prisma.cleaningLog.findMany({
      where: {
        task: { venueId },
        completedAt: {
          gte: from ? parseDateOnlyStartOfDayInZone(from, venue?.timezone) : undefined,
          lte: to ? parseDateOnlyEndOfDayInZone(to, venue?.timezone) : undefined,
        },
      },
      include: {
        task: true,
        employee: { select: { firstName: true, lastName: true } },
        user: { select: { email: true } },
      },
      orderBy: { completedAt: 'desc' },
    });
  }
}
