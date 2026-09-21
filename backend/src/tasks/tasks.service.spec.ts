import { NotFoundException } from '@nestjs/common';
import { TaskRecurrence, TaskStatus, TaskType } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    title: 'Rinnovo attestato HACCP',
    description: null,
    type: TaskType.CERTIFICATE_EXPIRY,
    dueDate: new Date('2026-01-15T00:00:00.000Z'),
    reminderDaysBefore: 7,
    recurrence: TaskRecurrence.NONE,
    status: TaskStatus.OPEN,
    relatedEmployeeId: null,
    assignedToId: null,
    venueId: 'venue-1',
    createdById: 'user-1',
    ...overrides,
  };
}

describe('TasksService', () => {
  let prisma: {
    task: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: TasksService;

  beforeEach(() => {
    prisma = {
      task: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new TasksService(prisma as unknown as PrismaService);
  });

  describe('isolamento tenant', () => {
    it('rifiuta il completamento di un\'attività di un altro locale (404, non 403)', async () => {
      prisma.task.findUnique.mockResolvedValue(makeTask({ venueId: 'venue-2' }));

      await expect(service.complete('venue-1', 'task-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('rifiuta la rimozione di un\'attività inesistente', async () => {
      prisma.task.findUnique.mockResolvedValue(null);

      await expect(service.remove('venue-1', 'task-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.task.delete).not.toHaveBeenCalled();
    });
  });

  describe('avanzamento ricorrenza al completamento', () => {
    it('non crea una nuova occorrenza se non ricorrente', async () => {
      const task = makeTask({ recurrence: TaskRecurrence.NONE });
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.task.update.mockResolvedValue({ ...task, status: TaskStatus.DONE });

      await service.complete('venue-1', 'task-1');

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('sposta la scadenza di 7 giorni per la ricorrenza settimanale', async () => {
      const task = makeTask({ recurrence: TaskRecurrence.WEEKLY });
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.task.update.mockResolvedValue({ ...task, status: TaskStatus.DONE });

      await service.complete('venue-1', 'task-1');

      expect(prisma.task.create).toHaveBeenCalledTimes(1);
      const created = prisma.task.create.mock.calls[0][0].data;
      expect(created.dueDate.toISOString()).toBe('2026-01-22T00:00:00.000Z');
      expect(created.recurrence).toBe(TaskRecurrence.WEEKLY);
    });

    it('sposta la scadenza di 1 mese per la ricorrenza mensile', async () => {
      const task = makeTask({ recurrence: TaskRecurrence.MONTHLY });
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.task.update.mockResolvedValue({ ...task, status: TaskStatus.DONE });

      await service.complete('venue-1', 'task-1');

      const created = prisma.task.create.mock.calls[0][0].data;
      expect(created.dueDate.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    });

    it('sposta la scadenza di 1 anno per la ricorrenza annuale', async () => {
      const task = makeTask({ recurrence: TaskRecurrence.YEARLY });
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.task.update.mockResolvedValue({ ...task, status: TaskStatus.DONE });

      await service.complete('venue-1', 'task-1');

      const created = prisma.task.create.mock.calls[0][0].data;
      expect(created.dueDate.toISOString()).toBe('2027-01-15T00:00:00.000Z');
    });
  });
});
