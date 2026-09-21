import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MailService } from './mail.service';
import { PrintingService } from '../printing/printing.service';

const adminUser: AuthenticatedUser = {
  userId: 'user-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

describe('OrdersService.createOrder', () => {
  let prisma: {
    supplier: { findUnique: jest.Mock };
    product: { findMany: jest.Mock };
    order: { create: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      supplier: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
      order: { create: jest.fn().mockResolvedValue({ id: 'order-1' }) },
    };
    audit = { log: jest.fn() };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as unknown as MailService,
      {} as unknown as PrintingService,
    );
  });

  it('calcola la quantità da ordinare come max(0, standard - giacenza)', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 10, category: { venueId: 'venue-1' } },
      { id: 'p2', standardQty: 3, category: { venueId: 'venue-1' } },
    ]);

    await service.createOrder(adminUser, {
      supplierId: 'sup-1',
      lines: [
        { productId: 'p1', stockOnHand: 4 }, // 10 - 4 = 6
        { productId: 'p2', stockOnHand: 5 }, // 3 - 5 = -2 -> mai negativa, 0
      ],
    });

    const created = prisma.order.create.mock.calls[0][0].data.lines.create;
    expect(created).toEqual([
      { productId: 'p1', stockOnHand: 4, suggestedQty: 6, orderedQty: 6 },
      { productId: 'p2', stockOnHand: 5, suggestedQty: 0, orderedQty: 0 },
    ]);
  });

  it('rifiuta un fornitore di un altro locale', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-2' });

    await expect(
      service.createOrder(adminUser, { supplierId: 'sup-1', lines: [{ productId: 'p1', stockOnHand: 0 }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignora un prodotto di un altro locale anche se l\'id è indovinato', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });
    // Il prodotto esiste ma appartiene a un altro locale: non deve finire
    // nell'ordine, altrimenti un ADMIN potrebbe leggere/riferire dati di un
    // locale che non è il suo semplicemente indovinando l'id.
    prisma.product.findMany.mockResolvedValue([
      { id: 'p-other-venue', standardQty: 100, category: { venueId: 'venue-2' } },
    ]);

    await expect(
      service.createOrder(adminUser, {
        supplierId: 'sup-1',
        lines: [{ productId: 'p-other-venue', stockOnHand: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
