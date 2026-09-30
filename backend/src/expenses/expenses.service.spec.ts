import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExpensesService', () => {
  let prisma: {
    expensePaymentMethod: {
      create: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    wallet: {
      create: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    task: { findUnique: jest.Mock };
    expense: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: ExpensesService;

  const paymentMethod = { id: 'pm-1', venueId: 'venue-1', name: 'Contanti', active: true };
  const wallet = { id: 'w-1', venueId: 'venue-1', name: 'Cassa contanti', active: true };
  const task = { id: 'task-1', venueId: 'venue-1' };

  beforeEach(() => {
    prisma = {
      expensePaymentMethod: {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      wallet: {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      task: { findUnique: jest.fn() },
      expense: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ExpensesService(prisma as unknown as PrismaService);
  });

  function baseExpenseDto(overrides?: Record<string, unknown>) {
    return {
      description: 'Carta forno',
      amount: 50,
      date: '2026-01-10',
      paymentMethodId: 'pm-1',
      walletId: 'w-1',
      ...overrides,
    };
  }

  describe('seedDefaults', () => {
    it('crea i metodi di pagamento e i portafogli tipici per il nuovo locale (§5.5, §10)', async () => {
      await service.seedDefaults('venue-1');
      expect(prisma.expensePaymentMethod.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'Contanti', venueId: 'venue-1' },
          { name: 'Bancomat', venueId: 'venue-1' },
          { name: 'Carta di credito', venueId: 'venue-1' },
          { name: 'Bonifico', venueId: 'venue-1' },
        ],
      });
      expect(prisma.wallet.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'Cassa contanti', venueId: 'venue-1' },
          { name: 'Conto corrente', venueId: 'venue-1' },
        ],
      });
    });
  });

  describe('createExpense — spesa autonoma', () => {
    it('crea una spesa senza scadenza collegata', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      prisma.expense.create.mockResolvedValue({ id: 'exp-1' });

      await service.createExpense('venue-1', 'user-1', baseExpenseDto());

      expect(prisma.task.findUnique).not.toHaveBeenCalled();
      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Carta forno',
            amount: 50,
            venueId: 'venue-1',
            paymentMethodId: 'pm-1',
            walletId: 'w-1',
            taskId: undefined,
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('rifiuta un metodo di pagamento di un altro locale', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue({ ...paymentMethod, venueId: 'venue-2' });
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      await expect(service.createExpense('venue-1', 'user-1', baseExpenseDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rifiuta un portafoglio inesistente', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      prisma.wallet.findUnique.mockResolvedValue(null);
      await expect(service.createExpense('venue-1', 'user-1', baseExpenseDto())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createExpense — collegata a una scadenza', () => {
    it('crea una spesa collegata a una scadenza dello stesso locale', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.expense.create.mockResolvedValue({ id: 'exp-1' });

      await service.createExpense('venue-1', 'user-1', baseExpenseDto({ taskId: 'task-1' }));

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ taskId: 'task-1' }) }),
      );
    });

    it('rifiuta una scadenza di un altro locale', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      prisma.task.findUnique.mockResolvedValue({ ...task, venueId: 'venue-2' });
      await expect(
        service.createExpense('venue-1', 'user-1', baseExpenseDto({ taskId: 'task-1' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('traduce il conflitto "al più una spesa per scadenza" (vincolo unique su taskId) in un 400 leggibile', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      prisma.task.findUnique.mockResolvedValue(task);
      prisma.expense.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );
      await expect(
        service.createExpense('venue-1', 'user-1', baseExpenseDto({ taskId: 'task-1' })),
      ).rejects.toThrow(/già una spesa collegata/);
    });
  });

  describe('list — filtri', () => {
    it('applica intervallo date, metodo, portafoglio e origine', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      await service.list('venue-1', {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        paymentMethodId: 'pm-1',
        walletId: 'w-1',
        origin: 'linked',
      });
      const call = prisma.expense.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        venueId: 'venue-1',
        paymentMethodId: 'pm-1',
        walletId: 'w-1',
        taskId: { not: null },
      });
      expect(call.where.date.gte).toEqual(new Date('2026-01-01'));
      expect(call.where.date.lte).toEqual(new Date('2026-01-31'));
    });

    it('"standalone" filtra solo le spese senza scadenza collegata', async () => {
      prisma.expense.findMany.mockResolvedValue([]);
      await service.list('venue-1', { origin: 'standalone' });
      const call = prisma.expense.findMany.mock.calls[0][0];
      expect(call.where.taskId).toBeNull();
    });
  });

  describe('removeExpense', () => {
    it('cancella la spesa senza toccare la scadenza collegata (restano indipendenti, §5.5)', async () => {
      prisma.expense.findUnique.mockResolvedValue({ id: 'exp-1', venueId: 'venue-1', taskId: 'task-1' });
      await service.removeExpense('venue-1', 'exp-1');
      expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'exp-1' } });
    });

    it('rifiuta la cancellazione di una spesa di un altro locale', async () => {
      prisma.expense.findUnique.mockResolvedValue({ id: 'exp-1', venueId: 'venue-2' });
      await expect(service.removeExpense('venue-1', 'exp-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('metodi di pagamento / portafogli — disattivazione invece di cancellazione', () => {
    it('removePaymentMethod disattiva senza eliminare (storico spese preservato)', async () => {
      prisma.expensePaymentMethod.findUnique.mockResolvedValue(paymentMethod);
      await service.removePaymentMethod('venue-1', 'pm-1');
      expect(prisma.expensePaymentMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-1' },
        data: { active: false },
      });
    });

    it('removeWallet disattiva senza eliminare', async () => {
      prisma.wallet.findUnique.mockResolvedValue(wallet);
      await service.removeWallet('venue-1', 'w-1');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: { active: false },
      });
    });
  });
});
