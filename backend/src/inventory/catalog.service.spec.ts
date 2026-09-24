import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CatalogService.createProduct — isolamento tenant', () => {
  let prisma: {
    productCategory: { findUnique: jest.Mock };
    supplier: { findUnique: jest.Mock };
    product: { create: jest.Mock };
  };
  let service: CatalogService;

  const dto = {
    name: 'Birra 33cl',
    unit: 'pz',
    standardQty: 24,
    categoryId: 'cat-1',
    supplierId: 'sup-1',
  };

  beforeEach(() => {
    prisma = {
      productCategory: { findUnique: jest.fn() },
      supplier: { findUnique: jest.fn() },
      product: { create: jest.fn() },
    };
    service = new CatalogService(prisma as unknown as PrismaService);
  });

  it('crea il prodotto quando categoria e fornitore sono del locale corretto', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });
    prisma.product.create.mockResolvedValue({ id: 'prod-1', ...dto });

    await expect(service.createProduct('venue-1', dto)).resolves.toEqual({
      id: 'prod-1',
      ...dto,
    });
  });

  it('rifiuta una categoria di un altro locale (indovinata via id)', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-2' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });

    await expect(service.createProduct('venue-1', dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rifiuta un fornitore di un altro locale (indovinato via id)', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-2' });

    await expect(service.createProduct('venue-1', dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});

describe('CatalogService.getProductTrends', () => {
  let prisma: {
    product: { findMany: jest.Mock };
    order: { findMany: jest.Mock };
  };
  let service: CatalogService;

  const ordersWithStock = (values: number[]) =>
    values.map((stockOnHand) => ({ lines: [{ productId: 'p1', stockOnHand }] }));

  beforeEach(() => {
    prisma = {
      product: { findMany: jest.fn() },
      order: { findMany: jest.fn() },
    };
    service = new CatalogService(prisma as unknown as PrismaService);
  });

  it('UP quando la giacenza media è sotto la metà dello standard', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 4, supplierId: 'sup-1' },
    ]);
    prisma.order.findMany.mockResolvedValue(ordersWithStock([1, 1, 1, 1])); // media 1, metà standard = 2

    const trends = await service.getProductTrends('venue-1', ['p1']);
    expect(trends.p1).toBe('UP');
  });

  it('DOWN quando la giacenza media è sopra la metà dello standard', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 4, supplierId: 'sup-1' },
    ]);
    prisma.order.findMany.mockResolvedValue(ordersWithStock([3, 3, 3, 3])); // media 3, metà standard = 2

    const trends = await service.getProductTrends('venue-1', ['p1']);
    expect(trends.p1).toBe('DOWN');
  });

  it('STABLE quando la giacenza media coincide con la metà dello standard', async () => {
    // media di [0,0,1,1] = 0.5, metà di uno standard di 1 = 0.5.
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 1, supplierId: 'sup-1' },
    ]);
    prisma.order.findMany.mockResolvedValue(ordersWithStock([0, 0, 1, 1]));

    const trends = await service.getProductTrends('venue-1', ['p1']);
    expect(trends.p1).toBe('STABLE');
  });

  it('nessun trend con meno di 4 ordini inviati recenti', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 4, supplierId: 'sup-1' },
    ]);
    prisma.order.findMany.mockResolvedValue(ordersWithStock([1, 1, 1]));

    const trends = await service.getProductTrends('venue-1', ['p1']);
    expect(trends.p1).toBeNull();
  });

  it('nessun trend se il prodotto manca in uno degli ultimi ordini al fornitore', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 4, supplierId: 'sup-1' },
    ]);
    prisma.order.findMany.mockResolvedValue([
      { lines: [{ productId: 'p1', stockOnHand: 1 }] },
      { lines: [{ productId: 'p1', stockOnHand: 1 }] },
      { lines: [{ productId: 'p1', stockOnHand: 1 }] },
      { lines: [] }, // ordine senza una riga per questo prodotto
    ]);

    const trends = await service.getProductTrends('venue-1', ['p1']);
    expect(trends.p1).toBeNull();
  });

  it('raggruppa i prodotti per fornitore: una sola query di ordini per fornitore coinvolto', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', standardQty: 4, supplierId: 'sup-1' },
      { id: 'p2', standardQty: 4, supplierId: 'sup-1' },
      { id: 'p3', standardQty: 4, supplierId: 'sup-2' },
    ]);
    prisma.order.findMany.mockResolvedValue([]);

    await service.getProductTrends('venue-1', ['p1', 'p2', 'p3']);

    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('CatalogService.listSuppliersDueToday — fuso orario del locale', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    supplier: { findMany: jest.Mock };
  };
  let service: CatalogService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn() },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CatalogService(prisma as unknown as PrismaService);
    // Giovedì 15 gennaio 2026 23:30 UTC (ISO weekday 4) è già venerdì
    // (ISO weekday 5) a Roma — prova diretta che il calcolo usa il fuso
    // del locale, non quello UTC/del server.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T23:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa il fuso orario del locale per calcolare il giorno della settimana', async () => {
    prisma.venue.findUnique.mockResolvedValue({ timezone: 'Europe/Rome' });

    await service.listSuppliersDueToday('venue-1');

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderDays: { has: 5 } }) }),
    );
  });

  it('due fusi diversi per lo stesso istante possono dare un giorno diverso', async () => {
    prisma.venue.findUnique.mockResolvedValue({ timezone: 'America/Los_Angeles' });

    await service.listSuppliersDueToday('venue-1');

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderDays: { has: 4 } }) }),
    );
  });
});
