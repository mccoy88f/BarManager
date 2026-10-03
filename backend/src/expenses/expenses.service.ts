import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ReceiptSection } from '../reports/pdf.service';

export interface ExpenseFilters {
  dateFrom?: string;
  dateTo?: string;
  paymentMethodId?: string;
  walletId?: string;
  /** 'linked' = solo spese collegate a una scadenza, 'standalone' = solo autonome. */
  origin?: 'linked' | 'standalone';
}

const EXPENSE_INCLUDE = {
  paymentMethod: true,
  wallet: true,
  task: { select: { id: true, title: true, orderId: true } },
  createdBy: { select: { email: true } },
} as const;

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Righe precompilate alla creazione del locale (§5.5, §10): valori
   * tipici, l'admin le estende/modifica/disattiva liberamente da qui in
   * poi come ogni altra lista configurabile.
   */
  async seedDefaults(venueId: string) {
    await this.prisma.expensePaymentMethod.createMany({
      data: ['Contanti', 'Bancomat', 'Carta di credito', 'Bonifico'].map((name) => ({
        name,
        venueId,
      })),
    });
    await this.prisma.wallet.createMany({
      data: ['Cassa contanti', 'Conto corrente'].map((name) => ({ name, venueId })),
    });
  }

  // --- Metodi di pagamento -------------------------------------------------

  createPaymentMethod(venueId: string, dto: CreatePaymentMethodDto) {
    return this.prisma.expensePaymentMethod.create({ data: { ...dto, venueId } });
  }

  listPaymentMethods(venueId: string) {
    return this.prisma.expensePaymentMethod.findMany({
      where: { venueId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async updatePaymentMethod(venueId: string, id: string, dto: UpdatePaymentMethodDto) {
    const method = await this.prisma.expensePaymentMethod.findUnique({ where: { id } });
    if (!method || method.venueId !== venueId) {
      throw new NotFoundException('Metodo di pagamento non trovato');
    }
    return this.prisma.expensePaymentMethod.update({ where: { id }, data: dto });
  }

  /** Disattiva senza perdere lo storico delle spese già collegate. */
  async removePaymentMethod(venueId: string, id: string) {
    const method = await this.prisma.expensePaymentMethod.findUnique({ where: { id } });
    if (!method || method.venueId !== venueId) {
      throw new NotFoundException('Metodo di pagamento non trovato');
    }
    await this.prisma.expensePaymentMethod.update({ where: { id }, data: { active: false } });
    return { success: true };
  }

  // --- Portafogli ------------------------------------------------------------

  createWallet(venueId: string, dto: CreateWalletDto) {
    return this.prisma.wallet.create({ data: { ...dto, venueId } });
  }

  listWallets(venueId: string) {
    return this.prisma.wallet.findMany({
      where: { venueId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateWallet(venueId: string, id: string, dto: UpdateWalletDto) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    if (!wallet || wallet.venueId !== venueId) {
      throw new NotFoundException('Portafoglio non trovato');
    }
    return this.prisma.wallet.update({ where: { id }, data: dto });
  }

  async removeWallet(venueId: string, id: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    if (!wallet || wallet.venueId !== venueId) {
      throw new NotFoundException('Portafoglio non trovato');
    }
    await this.prisma.wallet.update({ where: { id }, data: { active: false } });
    return { success: true };
  }

  // --- Spese -------------------------------------------------------------

  async createExpense(venueId: string, createdById: string, dto: CreateExpenseDto) {
    const [paymentMethod, wallet] = await Promise.all([
      this.prisma.expensePaymentMethod.findUnique({ where: { id: dto.paymentMethodId } }),
      this.prisma.wallet.findUnique({ where: { id: dto.walletId } }),
    ]);
    if (!paymentMethod || paymentMethod.venueId !== venueId) {
      throw new BadRequestException('Metodo di pagamento non valido');
    }
    if (!wallet || wallet.venueId !== venueId) {
      throw new BadRequestException('Portafoglio non valido');
    }
    if (dto.taskId) {
      const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });
      if (!task || task.venueId !== venueId) {
        throw new BadRequestException('Scadenza non valida');
      }
    }

    try {
      return await this.prisma.expense.create({
        data: {
          description: dto.description,
          amount: dto.amount,
          date: new Date(dto.date),
          venueId,
          paymentMethodId: dto.paymentMethodId,
          walletId: dto.walletId,
          taskId: dto.taskId,
          createdById,
        },
        include: EXPENSE_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Questa scadenza ha già una spesa collegata');
      }
      throw err;
    }
  }

  list(venueId: string, filters: ExpenseFilters) {
    const where: Prisma.ExpenseWhereInput = {
      venueId,
      ...(filters.paymentMethodId ? { paymentMethodId: filters.paymentMethodId } : {}),
      ...(filters.walletId ? { walletId: filters.walletId } : {}),
      ...(filters.origin === 'linked' ? { taskId: { not: null } } : {}),
      ...(filters.origin === 'standalone' ? { taskId: null } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            date: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    };
    return this.prisma.expense.findMany({
      where,
      include: EXPENSE_INCLUDE,
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Stesso elenco filtrato di list(), come sezione strutturata a larghezza
   * scontrino: usato dall'app Android nativa (§5.11 di docs/DEVELOPMENT.md)
   * per la stampa ESC/POS diretta, al posto del window.print() del browser
   * sulla tabella a video.
   */
  async getEscposSections(venueId: string, filters: ExpenseFilters): Promise<ReceiptSection[]> {
    const expenses = await this.list(venueId, filters);
    const lines = expenses.flatMap((e) => [
      `${e.date.toLocaleDateString('it-IT')}  € ${e.amount.toFixed(2)}`,
      `  ${e.description}`,
      `  ${e.paymentMethod.name} — ${e.wallet.name}`,
    ]);
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);

    return [
      {
        title: 'Report Spese',
        lines: lines.length ? lines : ['Nessuna spesa nel periodo selezionato.'],
        footer: [{ text: `TOTALE: € ${total.toFixed(2)}`, bold: true }],
      },
    ];
  }

  async updateExpense(venueId: string, id: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.venueId !== venueId) {
      throw new NotFoundException('Spesa non trovata');
    }
    if (dto.paymentMethodId) {
      const method = await this.prisma.expensePaymentMethod.findUnique({
        where: { id: dto.paymentMethodId },
      });
      if (!method || method.venueId !== venueId) {
        throw new BadRequestException('Metodo di pagamento non valido');
      }
    }
    if (dto.walletId) {
      const wallet = await this.prisma.wallet.findUnique({ where: { id: dto.walletId } });
      if (!wallet || wallet.venueId !== venueId) {
        throw new BadRequestException('Portafoglio non valido');
      }
    }
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.paymentMethodId !== undefined ? { paymentMethodId: dto.paymentMethodId } : {}),
        ...(dto.walletId !== undefined ? { walletId: dto.walletId } : {}),
      },
      include: EXPENSE_INCLUDE,
    });
  }

  async removeExpense(venueId: string, id: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense || expense.venueId !== venueId) {
      throw new NotFoundException('Spesa non trovata');
    }
    // Cancellare la spesa non riapre la scadenza collegata (§5.5): restano
    // due entità indipendenti una volta create.
    await this.prisma.expense.delete({ where: { id } });
    return { success: true };
  }
}
