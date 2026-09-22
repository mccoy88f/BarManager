import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CleaningFrequencyUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateCleaningTaskDto } from './dto/create-cleaning-task.dto';
import { UpdateCleaningTaskDto } from './dto/update-cleaning-task.dto';

/** Inizio/fine (esclusa) del periodo corrente per una ricorrenza di pulizia. */
function periodRange(unit: CleaningFrequencyUnit): { start: Date; end: Date } {
  const now = new Date();
  if (unit === CleaningFrequencyUnit.DAY) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  if (unit === CleaningFrequencyUnit.WEEK) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const isoWeekday = (start.getUTCDay() + 6) % 7; // 0=lunedì .. 6=domenica
    start.setUTCDate(start.getUTCDate() - isoWeekday);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
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
    const tasks = await this.listTasks(venueId);
    return Promise.all(
      tasks.map(async (task) => {
        const { start, end } = periodRange(task.frequencyUnit);
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

  /** Il dipendente che chiama segna la voce come fatta ora. */
  async complete(user: AuthenticatedUser, taskId: string) {
    const venueId = requireVenueId(user);
    const task = await this.prisma.cleaningTask.findUnique({ where: { id: taskId } });
    if (!task || task.venueId !== venueId) {
      throw new NotFoundException('Voce di pulizia non trovata');
    }

    const employee = await this.prisma.employee.findUnique({ where: { userId: user.userId } });
    if (!employee) {
      throw new BadRequestException('Utente non collegato a un dipendente');
    }

    const log = await this.prisma.cleaningLog.create({
      data: { taskId, employeeId: employee.id },
      include: { task: true, employee: { select: { firstName: true, lastName: true } } },
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
  listLogs(venueId: string, from?: string, to?: string) {
    const toDate = to ? new Date(to) : undefined;
    toDate?.setUTCHours(23, 59, 59, 999);

    return this.prisma.cleaningLog.findMany({
      where: {
        task: { venueId },
        completedAt: {
          gte: from ? new Date(from) : undefined,
          lte: toDate,
        },
      },
      include: { task: true, employee: { select: { firstName: true, lastName: true } } },
      orderBy: { completedAt: 'desc' },
    });
  }
}
