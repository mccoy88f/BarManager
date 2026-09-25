import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { XlsxService } from '../reports/xlsx.service';

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
    service = new CatalogService(prisma as unknown as PrismaService, {} as never);
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
    service = new CatalogService(prisma as unknown as PrismaService, {} as never);
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
    service = new CatalogService(prisma as unknown as PrismaService, {} as never);
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

describe('CatalogService.importXlsx / exportXlsx', () => {
  let prisma: {
    productCategory: { findMany: jest.Mock };
    supplier: { findMany: jest.Mock };
    product: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let xlsx: { buildSheet: jest.Mock; readSheet: jest.Mock };
  let service: CatalogService;

  beforeEach(() => {
    prisma = {
      productCategory: { findMany: jest.fn().mockResolvedValue([{ id: 'cat-1', name: 'Bevande', venueId: 'venue-1' }]) },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 'sup-1', name: 'Birrificio', venueId: 'venue-1' }]) },
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    xlsx = {
      buildSheet: jest.fn().mockResolvedValue(Buffer.from('fake-xlsx')),
      readSheet: jest.fn().mockResolvedValue([]),
    };
    service = new CatalogService(prisma as unknown as PrismaService, xlsx as unknown as XlsxService);
  });

  it('esporta i prodotti con categoria e fornitore risolti per nome', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Birra 33cl',
        unit: 'pz',
        standardQty: 24,
        reorderAt: null,
        supplierCode: null,
        costPerUnit: null,
        unitsPerPackage: null,
        active: true,
        category: { name: 'Bevande' },
        supplier: { name: 'Birrificio' },
      },
    ]);

    await service.exportXlsx('venue-1');

    expect(xlsx.buildSheet).toHaveBeenCalledWith(
      'Prodotti',
      expect.any(Array),
      [expect.objectContaining({ name: 'Birra 33cl', category: 'Bevande', supplier: 'Birrificio', active: 'SI' })],
    );
  });

  it('crea un nuovo prodotto quando categoria e fornitore esistono e nessun prodotto corrisponde', async () => {
    xlsx.readSheet.mockResolvedValue([
      { Nome: 'Birra 33cl', Unità: 'pz', 'Quantità standard': 24, Categoria: 'Bevande', Fornitore: 'Birrificio' },
    ]);

    const result = await service.importXlsx('venue-1', Buffer.from('x'));

    expect(result).toEqual({ created: 1, updated: 0, errors: [] });
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Birra 33cl', categoryId: 'cat-1', supplierId: 'sup-1' }),
      }),
    );
  });

  it('aggiorna un prodotto esistente trovato per nome quando "ID prodotto" è assente', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Birra 33cl' });
    xlsx.readSheet.mockResolvedValue([
      { Nome: 'Birra 33cl', Unità: 'pz', 'Quantità standard': 30, Categoria: 'Bevande', Fornitore: 'Birrificio' },
    ]);

    const result = await service.importXlsx('venue-1', Buffer.from('x'));

    expect(result).toEqual({ created: 0, updated: 1, errors: [] });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ standardQty: 30 }) }),
    );
  });

  it('segnala un errore per riga se la categoria non esiste, senza bloccare le altre righe', async () => {
    xlsx.readSheet.mockResolvedValue([
      { Nome: 'Prodotto fantasma', Unità: 'pz', 'Quantità standard': 1, Categoria: 'Inesistente', Fornitore: 'Birrificio' },
      { Nome: 'Birra 33cl', Unità: 'pz', 'Quantità standard': 24, Categoria: 'Bevande', Fornitore: 'Birrificio' },
    ]);

    const result = await service.importXlsx('venue-1', Buffer.from('x'));

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('categoria "Inesistente" non trovata');
  });

  it('segnala un errore per riga se mancano i campi obbligatori', async () => {
    xlsx.readSheet.mockResolvedValue([{ Nome: '', Unità: '', 'Quantità standard': '' }]);

    const result = await service.importXlsx('venue-1', Buffer.from('x'));

    expect(result).toEqual({ created: 0, updated: 0, errors: [expect.stringContaining('obbligatori')] });
  });
});
