import { NotFoundException } from '@nestjs/common';
import { LoyverseSyncService } from './loyverse-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret } from '../common/crypto/secret-crypto';
import { loyverseClient } from './loyverse-client';

jest.mock('./loyverse-client', () => ({
  ...jest.requireActual('./loyverse-client'),
  loyverseClient: {
    listCategories: jest.fn(),
    listItems: jest.fn(),
    extractImageUrl: jest.fn(() => undefined),
  },
}));

describe('LoyverseSyncService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    menuCategory: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    menuItem: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    menuItemVariant: { create: jest.Mock; update: jest.Mock };
  };
  let service: LoyverseSyncService;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = 'test-key';
    prisma = {
      venue: { findUnique: jest.fn(), update: jest.fn() },
      menuCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      menuItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      menuItemVariant: { create: jest.fn(), update: jest.fn() },
    };
    service = new LoyverseSyncService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
    (loyverseClient.extractImageUrl as jest.Mock).mockReturnValue(undefined);
  });

  it('rifiuta il sync se l\'integrazione non è attiva o non ha un token', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: false });
    await expect(service.sync('venue-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('crea categoria e voce di menù (con variante) da un item Loyverse senza corrispondenza locale', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Birra',
        description: 'Birra artigianale alla spina',
        category_id: 'cat-ext-1',
        variants: [{ variant_id: 'var-ext-1', default_pricing_type: 'FIXED', default_price: 4.5 }],
      },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-local-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    const summary = await service.sync('venue-1');

    expect(prisma.menuCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Bevande', loyverseCategoryId: 'cat-ext-1', visible: false }),
      }),
    );
    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Birra',
          description: 'Birra artigianale alla spina',
          loyverseItemId: 'item-ext-1',
          categoryId: 'cat-local-1',
          visible: false,
        }),
      }),
    );
    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: '', price: 4.5, sortOrder: 0, menuItemId: 'item-local-1', loyverseVariantId: 'var-ext-1' },
    });
    expect(summary.categories).toBe(1);
    expect(summary.items).toBe(1);
    expect(summary.warnings).toEqual([]);
    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: 'venue-1' },
      data: {
        loyverseLastSyncAt: expect.any(Date),
        loyverseLastSyncError: null,
        loyverseLastSyncSummary: {
          categories: 1,
          items: 1,
          itemsRemoved: 0,
          categoriesRemoved: 0,
          imagesDownloaded: 0,
          imagesSkipped: true,
          warnings: [],
        },
      },
    });
  });

  it('aggiorna la descrizione di una voce già sincronizzata quando cambia su Loyverse', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    prisma.menuCategory.findMany.mockResolvedValue([
      { id: 'cat-local-1', venueId: 'venue-1', loyverseCategoryId: 'cat-ext-1', name: 'Bevande', sortOrder: 0 },
    ]);
    prisma.menuItem.findFirst.mockResolvedValue({
      id: 'item-local-1',
      name: 'Birra',
      description: 'Vecchia descrizione',
      categoryId: 'cat-local-1',
      photoUrl: '/uploads/menu/existing.jpg',
      variants: [{ id: 'var-local-1', loyverseVariantId: 'var-ext-1' }],
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Birra',
        description: 'Nuova descrizione aggiornata da Loyverse',
        category_id: 'cat-ext-1',
        variants: [{ variant_id: 'var-ext-1', default_pricing_type: 'FIXED', default_price: 4.5 }],
      },
    ]);

    await service.sync('venue-1');

    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'item-local-1' },
      data: {
        name: 'Birra',
        categoryId: 'cat-local-1',
        description: 'Nuova descrizione aggiornata da Loyverse',
      },
    });
  });

  it('non modifica la visibilità di una voce già sincronizzata quando nulla è cambiato su Loyverse', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    prisma.menuCategory.findMany.mockResolvedValue([
      { id: 'cat-local-1', venueId: 'venue-1', loyverseCategoryId: 'cat-ext-1', name: 'Bevande', sortOrder: 0 },
    ]);
    // L'admin ha già pubblicato questa voce (visible: true): il secondo
    // sync non deve in alcun modo rimetterla nascosta.
    prisma.menuItem.findFirst.mockResolvedValue({
      id: 'item-local-1',
      name: 'Birra',
      description: 'Birra artigianale alla spina',
      categoryId: 'cat-local-1',
      visible: true,
      photoUrl: '/uploads/menu/existing.jpg',
      variants: [{ id: 'var-local-1', loyverseVariantId: 'var-ext-1' }],
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Birra',
        description: 'Birra artigianale alla spina',
        category_id: 'cat-ext-1',
        variants: [{ variant_id: 'var-ext-1', default_pricing_type: 'FIXED', default_price: 4.5 }],
      },
    ]);

    await service.sync('venue-1');

    expect(prisma.menuItem.update).not.toHaveBeenCalled();
  });

  it('elimina una voce già sincronizzata il cui prodotto non esiste più su Loyverse', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([]); // rimosso da Loyverse
    prisma.menuItem.findMany.mockResolvedValue([{ id: 'item-local-1', loyverseItemId: 'item-ext-1' }]);

    const summary = await service.sync('venue-1');

    expect(prisma.menuItem.delete).toHaveBeenCalledWith({ where: { id: 'item-local-1' } });
    expect(summary.itemsRemoved).toBe(1);
  });

  it('inserisce in "Altri prodotti" una voce Loyverse la cui categoria non è mappata, invece di scartarla', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Orfano',
        category_id: 'cat-mai-vista',
        variants: [{ variant_id: 'var-ext-1', default_pricing_type: 'FIXED', default_price: 3 }],
      },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-fallback-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    const summary = await service.sync('venue-1');

    expect(prisma.menuCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Altri prodotti', loyverseCategoryId: null, visible: false }),
      }),
    );
    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: 'cat-fallback-1' }) }),
    );
    expect(summary.items).toBe(1);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain('Altri prodotti');
  });

  it('costruisce il nome variante dai valori delle opzioni Loyverse quando ce ne sono più di una', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Pizze' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Margherita',
        category_id: 'cat-ext-1',
        option1_name: 'Formato',
        variants: [
          { variant_id: 'var-s', default_pricing_type: 'FIXED', default_price: 6, option1_value: 'Piccola' },
          { variant_id: 'var-l', default_pricing_type: 'FIXED', default_price: 9, option1_value: 'Grande' },
        ],
      },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-local-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    await service.sync('venue-1');

    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: 'Piccola', price: 6, sortOrder: 0, menuItemId: 'item-local-1', loyverseVariantId: 'var-s' },
    });
    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: 'Grande', price: 9, sortOrder: 1, menuItemId: 'item-local-1', loyverseVariantId: 'var-l' },
    });
  });

  it('sincronizza comunque una voce le cui varianti sono a prezzo variabile, senza importo', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Offerta libera',
        category_id: 'cat-ext-1',
        variants: [{ variant_id: 'var-ext-1', default_pricing_type: 'VARIABLE', default_price: null }],
      },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-local-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    const summary = await service.sync('venue-1');

    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: 'cat-local-1' }) }),
    );
    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: '', price: null, sortOrder: 0, menuItemId: 'item-local-1', loyverseVariantId: 'var-ext-1' },
    });
    expect(summary.items).toBe(1);
    expect(summary.warnings).toEqual([]);
  });

  it('sincronizza una voce Loyverse senza nessuna variante con un\'unica riga a prezzo variabile', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      { id: 'item-ext-1', item_name: 'Senza varianti', category_id: 'cat-ext-1', variants: [] },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-local-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    const summary = await service.sync('venue-1');

    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: '', price: null, sortOrder: 0, menuItemId: 'item-local-1', loyverseVariantId: '' },
    });
    expect(summary.items).toBe(1);
  });
});
