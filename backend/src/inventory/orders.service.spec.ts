import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MailService } from './mail.service';
import { PrintingService } from '../printing/printing.service';
import { PdfService } from '../reports/pdf.service';

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
      {} as unknown as PdfService,
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

describe('OrdersService.createOrdersByCategory', () => {
  let prisma: {
    productCategory: { findUnique: jest.Mock };
    product: { findMany: jest.Mock };
    order: { create: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      productCategory: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
      order: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `order-${data.supplierId}`, ...data }),
        ),
      },
    };
    audit = { log: jest.fn() };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as unknown as MailService,
      {} as unknown as PrintingService,
      {} as unknown as PdfService,
    );
  });

  it('divide le righe di una categoria in un ordine per ciascun fornitore coinvolto', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', supplierId: 'sup-1', standardQty: 10, categoryId: 'cat-1', category: { venueId: 'venue-1' } },
      { id: 'p2', supplierId: 'sup-2', standardQty: 5, categoryId: 'cat-1', category: { venueId: 'venue-1' } },
    ]);

    const orders = await service.createOrdersByCategory(adminUser, {
      categoryId: 'cat-1',
      lines: [
        { productId: 'p1', stockOnHand: 2 },
        { productId: 'p2', stockOnHand: 1 },
      ],
    });

    expect(orders).toHaveLength(2);
    expect(prisma.order.create).toHaveBeenCalledTimes(2);
    const supplierIds = prisma.order.create.mock.calls.map((c) => c[0].data.supplierId);
    expect(new Set(supplierIds)).toEqual(new Set(['sup-1', 'sup-2']));
  });

  it('rifiuta una categoria di un altro locale', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-2' });

    await expect(
      service.createOrdersByCategory(adminUser, {
        categoryId: 'cat-1',
        lines: [{ productId: 'p1', stockOnHand: 0 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('rifiuta se nessuna riga corrisponde a un prodotto della categoria', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.product.findMany.mockResolvedValue([]);

    await expect(
      service.createOrdersByCategory(adminUser, {
        categoryId: 'cat-1',
        lines: [{ productId: 'p-non-in-categoria', stockOnHand: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrdersService.sendOrders', () => {
  let prisma: { order: { findUnique: jest.Mock; update: jest.Mock }; employee: { findMany: jest.Mock } };
  let mail: { sendOrderEmail: jest.Mock };
  let service: OrdersService;

  const draftOrder = (id: string, supplierName: string) => ({
    id,
    venueId: 'venue-1',
    status: 'DRAFT',
    lines: [{ orderedQty: 2, product: { name: 'Prodotto', unit: 'pz' } }],
    supplier: { name: supplierName, email: `${supplierName}@test.it`, ccEmails: [] },
  });

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mail = { sendOrderEmail: jest.fn().mockResolvedValue({ sent: true }) };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      mail as unknown as MailService,
      {} as unknown as PrintingService,
      {} as unknown as PdfService,
    );
  });

  it('invia ogni ordine e riporta il risultato per fornitore', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(draftOrder('order-1', 'Fornitore A'))
      .mockResolvedValueOnce(draftOrder('order-2', 'Fornitore B'));
    prisma.order.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ ...draftOrder(where.id, 'x'), ...data, supplier: { name: 'x' } }),
    );

    const results = await service.sendOrders(adminUser, ['order-1', 'order-2']);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.sent)).toBe(true);
    expect(mail.sendOrderEmail).toHaveBeenCalledTimes(2);
  });

  it('un fornitore che fallisce non blocca gli altri', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce({ ...draftOrder('order-1', 'Fornitore A'), status: 'SENT' }) // già inviato -> errore
      .mockResolvedValueOnce(draftOrder('order-2', 'Fornitore B'));
    prisma.order.update.mockResolvedValue({ supplier: { name: 'Fornitore B' } });

    const results = await service.sendOrders(adminUser, ['order-1', 'order-2']);

    expect(results[0].sent).toBe(false);
    expect(results[1].sent).toBe(true);
  });
});

describe('OrdersService.updateLineQty', () => {
  let prisma: {
    orderLine: { findUnique: jest.Mock; update: jest.Mock };
  };
  let service: OrdersService;

  beforeEach(() => {
    prisma = {
      orderLine: { findUnique: jest.fn(), update: jest.fn() },
    };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditService,
      {} as unknown as MailService,
      {} as unknown as PrintingService,
      {} as unknown as PdfService,
    );
  });

  it('rifiuta la modifica di una riga di un ordine di un altro locale', async () => {
    prisma.orderLine.findUnique.mockResolvedValue({
      id: 'line-1',
      orderId: 'order-1',
      order: { venueId: 'venue-2' },
    });

    await expect(
      service.updateLineQty('venue-1', 'order-1', 'line-1', 5),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.orderLine.update).not.toHaveBeenCalled();
  });

  it('aggiorna la quantità quando la riga appartiene a un ordine del locale', async () => {
    prisma.orderLine.findUnique.mockResolvedValue({
      id: 'line-1',
      orderId: 'order-1',
      order: { venueId: 'venue-1' },
    });
    prisma.orderLine.update.mockResolvedValue({ id: 'line-1', orderedQty: 5 });

    await service.updateLineQty('venue-1', 'order-1', 'line-1', 5);
    expect(prisma.orderLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { orderedQty: 5 },
    });
  });
});

describe('OrdersService.buildPrintJob / exportPdf', () => {
  let prisma: { order: { findUnique: jest.Mock } };
  let printing: { buildReportJob: jest.Mock };
  let pdf: { buildReceiptDocument: jest.Mock };
  let service: OrdersService;

  const order = {
    id: 'order-1',
    venueId: 'venue-1',
    createdAt: new Date('2026-01-10'),
    sentAt: new Date('2026-01-11'),
    supplier: { name: 'Fornitore SRL' },
    createdBy: { email: 'admin@venue1.test' },
    lines: [
      { orderedQty: 3, product: { name: 'Birra', unit: 'cassa', costPerUnit: 10 } },
      { orderedQty: 0, product: { name: 'Non ordinato', unit: 'pz', costPerUnit: 5 } },
    ],
  };

  beforeEach(() => {
    prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
    printing = { buildReportJob: jest.fn().mockResolvedValue({ ready: true }) };
    pdf = {
      buildReceiptDocument: jest.fn(
        async (sections: { title: string; lines: string[]; footer?: string[] }[]) => {
          const text = sections
            .map((s) => [s.title, ...s.lines, ...(s.footer ?? [])].join('\n'))
            .join('\n===PAGE===\n');
          return Buffer.from(text);
        },
      ),
    };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditService,
      {} as unknown as MailService,
      printing as unknown as PrintingService,
      pdf as unknown as PdfService,
    );
  });

  it('prepara la checklist con le sole righe ordinate (quantità > 0)', async () => {
    await service.buildPrintJob('venue-1', 'order-1');

    expect(printing.buildReportJob).toHaveBeenCalledWith('venue-1', 'ORDERS', {
      title: 'Ordine Fornitore SRL',
      lines: [
        `Data: ${order.createdAt.toLocaleDateString('it-IT')}`,
        `Inviato: ${order.sentAt.toLocaleDateString('it-IT')}`,
        'Autore: admin@venue1.test',
        '',
        `${'Birra'.padEnd(24)} x 3 cassa  €10.00 = €30.00`,
      ],
      footer: ['Checklist per controllo scarico merce ->', '', 'TOTALE: €30.00'],
    });
  });

  it('genera il PDF a scontrino con fornitore, data, autore e importi', async () => {
    const buffer = await service.exportPdf('venue-1', 'order-1');
    const text = buffer.toString();

    expect(pdf.buildReceiptDocument).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Ordine Fornitore SRL' }),
    ]);
    expect(text).toContain('Autore: admin@venue1.test');
    expect(text).toContain('TOTALE: €30.00');
    expect(text).not.toContain('Non ordinato');
  });

  it('genera un PDF con una sezione per ordine nel batch', async () => {
    const otherOrder = { ...order, id: 'order-2', supplier: { name: 'Altro Fornitore' } };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(otherOrder);

    const buffer = await service.exportBatchPdf('venue-1', ['order-1', 'order-2']);
    const text = buffer.toString();

    expect(pdf.buildReceiptDocument).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Ordine Fornitore SRL' }),
      expect.objectContaining({ title: 'Ordine Altro Fornitore' }),
    ]);
    expect(text).toContain('===PAGE===');
  });
});
