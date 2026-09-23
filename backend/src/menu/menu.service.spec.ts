import { BadRequestException } from '@nestjs/common';
import { MenuService } from './menu.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MenuService varianti', () => {
  let prisma: {
    menuItem: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock };
    menuItemVariant: { deleteMany: jest.Mock };
    venue: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: MenuService;

  beforeEach(() => {
    prisma = {
      menuItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      menuItemVariant: { deleteMany: jest.fn() },
      venue: { findUnique: jest.fn().mockResolvedValue({ loyverseIntegrationEnabled: false }) },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    service = new MenuService(prisma as unknown as PrismaService);
  });

  it('crea una voce con più varianti, assegnando sortOrder in ordine', async () => {
    prisma.menuItem.create.mockResolvedValue({ id: 'item-1' });

    await service.createItem('venue-1', {
      name: 'Birra',
      categoryId: 'cat-1',
      variants: [
        { name: 'Piccola', price: 3.5 },
        { name: 'Grande', price: 5 },
      ],
    });

    const data = prisma.menuItem.create.mock.calls[0][0].data;
    expect(data.venueId).toBe('venue-1');
    expect(data.variants.create).toEqual([
      { name: 'Piccola', price: 3.5, sortOrder: 0 },
      { name: 'Grande', price: 5, sortOrder: 1 },
    ]);
  });

  it("assegna alla voce il sortOrder successivo all'ultima della stessa categoria", async () => {
    prisma.menuItem.findFirst.mockResolvedValue({ sortOrder: 4 });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-2' });

    await service.createItem('venue-1', {
      name: 'Vino',
      categoryId: 'cat-1',
      variants: [{ price: 6 }],
    });

    expect(prisma.menuItem.findFirst).toHaveBeenCalledWith({
      where: { venueId: 'venue-1', categoryId: 'cat-1' },
      orderBy: { sortOrder: 'desc' },
    });
    const data = prisma.menuItem.create.mock.calls[0][0].data;
    expect(data.sortOrder).toBe(5);
  });

  it('aggiornando con nuove varianti, sostituisce tutte quelle esistenti', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({ id: 'item-1' });

    await service.updateItem('venue-1', 'item-1', {
      variants: [{ name: '', price: 4 }],
    });

    expect(prisma.menuItemVariant.deleteMany).toHaveBeenCalledWith({
      where: { menuItemId: 'item-1' },
    });
    const data = prisma.menuItem.update.mock.calls[0][0].data;
    expect(data.variants.create).toEqual([{ name: '', price: 4, sortOrder: 0 }]);
  });

  it('aggiornando senza toccare le varianti, non le elimina né le ricrea', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({ id: 'item-1' });

    await service.updateItem('venue-1', 'item-1', { name: 'Nuovo nome' });

    expect(prisma.menuItemVariant.deleteMany).not.toHaveBeenCalled();
    const data = prisma.menuItem.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('variants');
    expect(data.name).toBe('Nuovo nome');
  });

  it('crea una variante a prezzo variabile quando il prezzo è omesso (in cassa, o a peso)', async () => {
    prisma.menuItem.create.mockResolvedValue({ id: 'item-1' });

    await service.createItem('venue-1', {
      name: 'Trancio pizza al taglio',
      categoryId: 'cat-1',
      variants: [{ price: null }],
    } as never);

    const data = prisma.menuItem.create.mock.calls[0][0].data;
    expect(data.variants.create).toEqual([{ price: null, sortOrder: 0 }]);
  });

  it('con integrazione Loyverse attiva rifiuta la creazione manuale di una voce', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: true });

    await expect(
      service.createItem('venue-1', { name: 'Extra', categoryId: 'cat-1', variants: [{ price: 5 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.menuItem.create).not.toHaveBeenCalled();
  });

  it('con integrazione attiva permette comunque di cambiare solo visibilità/descrizione', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: true });
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({ id: 'item-1' });

    await service.updateItem('venue-1', 'item-1', { description: 'Nuova descrizione' });

    expect(prisma.menuItem.update).toHaveBeenCalled();
  });

  it('con integrazione attiva rifiuta di cambiare nome o varianti di una voce esistente', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: true });
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });

    await expect(service.updateItem('venue-1', 'item-1', { name: 'Nuovo nome' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.menuItem.update).not.toHaveBeenCalled();
  });

  it('con integrazione attiva rifiuta di caricare una foto a mano: arriva da Loyverse', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: true });
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });

    await expect(
      service.setPhoto('venue-1', 'item-1', '/uploads/menu/foo.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.menuItem.update).not.toHaveBeenCalled();
  });

  it('senza integrazione permette di caricare una foto a mano', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: false });
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({ id: 'item-1', photoUrl: '/uploads/menu/foo.jpg' });

    await service.setPhoto('venue-1', 'item-1', '/uploads/menu/foo.jpg');

    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { photoUrl: '/uploads/menu/foo.jpg' },
    });
  });
});

describe('MenuService categorie', () => {
  let prisma: {
    menuCategory: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: MenuService;

  beforeEach(() => {
    prisma = {
      menuCategory: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    service = new MenuService(prisma as unknown as PrismaService);
  });

  it('riordina le categorie assegnando sortOrder secondo l\'elenco ricevuto', async () => {
    prisma.menuCategory.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([]);

    await service.reorderCategories('venue-1', ['c', 'a', 'b']);

    expect(prisma.menuCategory.update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { sortOrder: 0 } });
    expect(prisma.menuCategory.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sortOrder: 1 } });
    expect(prisma.menuCategory.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { sortOrder: 2 } });
  });

  it('rifiuta il riordino se gli id non corrispondono esattamente alle categorie del locale', async () => {
    prisma.menuCategory.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);

    await expect(service.reorderCategories('venue-1', ['a', 'x'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.menuCategory.update).not.toHaveBeenCalled();
  });

  it('imposta la visibilità di una categoria', async () => {
    prisma.menuCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.menuCategory.update.mockResolvedValue({ id: 'cat-1', visible: false });

    await service.setCategoryVisibility('venue-1', 'cat-1', false);

    expect(prisma.menuCategory.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { visible: false },
    });
  });
});

describe('MenuService.setFeatured', () => {
  let prisma: { menuItem: { findUnique: jest.Mock; update: jest.Mock } };
  let service: MenuService;

  beforeEach(() => {
    prisma = { menuItem: { findUnique: jest.fn(), update: jest.fn() } };
    service = new MenuService(prisma as unknown as PrismaService);
  });

  it('metta in evidenza una voce, permesso anche con integrazione Loyverse attiva', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({ id: 'item-1', featured: true });

    await service.setFeatured('venue-1', 'item-1', true);

    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { featured: true },
    });
  });

  it('rifiuta di mettere in evidenza una voce di un altro locale', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-2' });

    await expect(service.setFeatured('venue-1', 'item-1', true)).rejects.toThrow();
    expect(prisma.menuItem.update).not.toHaveBeenCalled();
  });
});

describe('MenuService.setVisibility', () => {
  let prisma: {
    menuItem: { findUnique: jest.Mock; update: jest.Mock };
    menuCategory: { update: jest.Mock };
  };
  let service: MenuService;

  beforeEach(() => {
    prisma = {
      menuItem: { findUnique: jest.fn(), update: jest.fn() },
      menuCategory: { update: jest.fn() },
    };
    service = new MenuService(prisma as unknown as PrismaService);
  });

  it('abilitando una voce la cui categoria è nascosta, riabilita anche la categoria', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({
      id: 'item-1',
      categoryId: 'cat-1',
      category: { id: 'cat-1', visible: false },
    });

    await service.setVisibility('venue-1', 'item-1', true);

    expect(prisma.menuCategory.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { visible: true },
    });
  });

  it('abilitando una voce la cui categoria è già visibile, non tocca la categoria', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({
      id: 'item-1',
      categoryId: 'cat-1',
      category: { id: 'cat-1', visible: true },
    });

    await service.setVisibility('venue-1', 'item-1', true);

    expect(prisma.menuCategory.update).not.toHaveBeenCalled();
  });

  it('disabilitando una voce non tocca la visibilità della categoria', async () => {
    prisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', venueId: 'venue-1' });
    prisma.menuItem.update.mockResolvedValue({
      id: 'item-1',
      categoryId: 'cat-1',
      category: { id: 'cat-1', visible: true },
    });

    await service.setVisibility('venue-1', 'item-1', false);

    expect(prisma.menuCategory.update).not.toHaveBeenCalled();
  });
});

describe('MenuService.getPublicMenu', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    menuCategory: { findMany: jest.Mock };
  };
  let service: MenuService;

  // Aperto tutto il giorno tutti i giorni, per non dipendere dall'ora/giorno
  // in cui girano i test (i due test sotto non riguardano il calcolo della
  // fascia pranzo/cena, solo la visibilità di categorie/voci).
  const alwaysOpenSchedule = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    closed: false,
    slot1Start: '00:00',
    slot1End: '23:59',
    slot2Start: null,
    slot2End: null,
  }));

  const baseVenue = {
    id: 'venue-1',
    active: true,
    name: 'Bar Demo',
    menuCoverUrl: null,
    menuPhone: null,
    menuInstagramUrl: null,
    menuFacebookUrl: null,
    menuWebsiteUrl: null,
    openingHours: alwaysOpenSchedule,
  };

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn().mockResolvedValue(baseVenue) },
      menuCategory: { findMany: jest.fn() },
    };
    service = new MenuService(prisma as unknown as PrismaService);
  });

  it('include una voce importata da Loyverse dopo che admin l\'ha resa visibile (categoria e voce)', async () => {
    // Simula quello che il database restituirebbe filtrando "visible: true"
    // sia sulla categoria che sulla voce, dopo che l'admin ha pubblicato
    // (con l'integrazione attiva) una voce arrivata nascosta dal sync.
    prisma.menuCategory.findMany.mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Bevande',
        items: [
          {
            id: 'item-1',
            name: 'Birra',
            description: null,
            photoUrl: null,
            allergens: [],
            unavailableUntil: null,
            variants: [{ id: 'var-1', name: '', price: 4.5 }],
          },
        ],
      },
    ]);

    const result = await service.getPublicMenu('venue-1');

    expect(prisma.menuCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { venueId: 'venue-1', visible: true } }),
    );
    const itemsWhere = prisma.menuCategory.findMany.mock.calls[0][0].include.items.where;
    expect(itemsWhere.visible).toBe(true);
    expect(result.categories).toEqual([
      {
        id: 'cat-1',
        name: 'Bevande',
        items: [
          {
            id: 'item-1',
            name: 'Birra',
            description: null,
            variants: [{ id: 'var-1', name: '', price: 4.5 }],
            photoUrl: null,
            allergens: [],
            available: true,
          },
        ],
      },
    ]);
  });

  it('non mostra una categoria le cui voci sono ancora tutte nascoste (default post-sync)', async () => {
    // Categoria resa visibile ma nessuna voce al suo interno ancora
    // pubblicata: il database la restituirebbe con items: [] perché il
    // "where: { visible: true }" sulle voci non trova nulla.
    prisma.menuCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Bevande', items: [] }]);

    const result = await service.getPublicMenu('venue-1');

    expect(result.categories).toEqual([]);
  });
});
