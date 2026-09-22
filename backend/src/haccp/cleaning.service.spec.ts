import { NotFoundException } from '@nestjs/common';
import { CleaningFrequencyUnit } from '@prisma/client';
import { CleaningService } from './cleaning.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

const employeeUser: AuthenticatedUser = {
  userId: 'user-1',
  email: 'dipendente@venue1.test',
  role: 'EMPLOYEE',
  venueId: 'venue-1',
};

describe('CleaningService', () => {
  let prisma: {
    cleaningTask: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    cleaningLog: { count: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    employee: { findUnique: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let service: CleaningService;

  beforeEach(() => {
    prisma = {
      cleaningTask: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
      cleaningLog: { count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
      employee: { findUnique: jest.fn() },
    };
    audit = { log: jest.fn() };
    service = new CleaningService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('listDueToday', () => {
    it('calcola le volte rimanenti nel periodo corrente per ogni voce', async () => {
      prisma.cleaningTask.findMany.mockResolvedValue([
        {
          id: 'task-1',
          description: 'Sgrassare friggitrice',
          location: 'Cucina',
          frequencyUnit: CleaningFrequencyUnit.DAY,
          timesPerUnit: 2,
          venueId: 'venue-1',
        },
        {
          id: 'task-2',
          description: 'Pulire vetrine',
          location: 'Sala',
          frequencyUnit: CleaningFrequencyUnit.WEEK,
          timesPerUnit: 1,
          venueId: 'venue-1',
        },
      ]);
      prisma.cleaningLog.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const result = await service.listDueToday('venue-1');

      expect(result[0]).toMatchObject({ id: 'task-1', completedInPeriod: 1, remaining: 1 });
      expect(result[1]).toMatchObject({ id: 'task-2', completedInPeriod: 1, remaining: 0 });
    });
  });

  describe('complete', () => {
    it("registra l'esecuzione per il dipendente collegato all'utente", async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({ id: 'task-1', venueId: 'venue-1' });
      prisma.employee.findUnique.mockResolvedValue({ id: 'employee-1' });
      prisma.cleaningLog.create.mockResolvedValue({ id: 'log-1', taskId: 'task-1', employeeId: 'employee-1' });

      const log = await service.complete(employeeUser, 'task-1');

      expect(prisma.cleaningLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taskId: 'task-1', employeeId: 'employee-1', userId: 'user-1' },
        }),
      );
      expect(log.id).toBe('log-1');
      expect(audit.log).toHaveBeenCalled();
    });

    it('rifiuta se la voce non esiste o è di un altro locale', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({ id: 'task-1', venueId: 'venue-2' });

      await expect(service.complete(employeeUser, 'task-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.cleaningLog.create).not.toHaveBeenCalled();
    });

    it("registra comunque l'esecuzione per chi non è collegato a un dipendente (es. l'admin), tracciata sull'utente", async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({ id: 'task-1', venueId: 'venue-1' });
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.cleaningLog.create.mockResolvedValue({ id: 'log-2', taskId: 'task-1', userId: 'admin-1' });

      const log = await service.complete(admin, 'task-1');

      expect(prisma.cleaningLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { taskId: 'task-1', employeeId: undefined, userId: 'admin-1' },
        }),
      );
      expect(log.id).toBe('log-2');
    });
  });
});
