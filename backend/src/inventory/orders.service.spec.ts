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

describe('OrdersService.printAgain / exportPdf', () => {
  let prisma: { order: { findUnique: jest.Mock } };
  let printing: { printReport: jest.Mock };
  let pdf: { buildDocument: jest.Mock };
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
    printing = { printReport: jest.fn().mockResolvedValue({ printed: true }) };
    pdf = {
      buildDocument: jest.fn(async (build) => {
        const calls: string[] = [];
        const doc: Record<string, jest.Mock> = {};
        const chain = () => doc as unknown as PDFKit.PDFDocument;
        doc.fontSize = jest.fn(chain);
        doc.moveDown = jest.fn(chain);
        doc.text = jest.fn((t: string) => {
          calls.push(t);
          return chain();
        });
        build(doc as unknown as PDFKit.PDFDocument);
        return Buffer.from(calls.join('\n'));
      }),
    };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      {} as unknown as AuditService,
      {} as unknown as MailService,
      printing as unknown as PrintingService,
      pdf as unknown as PdfService,
    );
  });

  it('ristampa la checklist con le sole righe ordinate (quantità > 0)', async () => {
    await service.printAgain('venue-1', 'order-1');

    expect(printing.printReport).toHaveBeenCalledWith('venue-1', 'ORDERS', {
      title: 'Ordine Fornitore SRL',
      lines: [`${'Birra'.padEnd(24)} x 3 cassa  €10.00 = €30.00`],
      footer: ['Checklist per controllo scarico merce ->', '', 'TOTALE: €30.00'],
    });
  });

  it('genera il PDF con fornitore, data, autore e importi', async () => {
    const buffer = await service.exportPdf('venue-1', 'order-1');
    const text = buffer.toString();

    expect(text).toContain('Fornitore: Fornitore SRL');
    expect(text).toContain('Autore: admin@venue1.test');
    expect(text).toContain('Totale: € 30.00');
    expect(text).not.toContain('Non ordinato');
  });
});
