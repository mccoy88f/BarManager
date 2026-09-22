import { BadRequestException } from '@nestjs/common';
import { MenuService } from './menu.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MenuService varianti', () => {
  let prisma: {
    menuItem: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    menuItemVariant: { deleteMany: jest.Mock };
    venue: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: MenuService;

  beforeEach(() => {
    prisma = {
      menuItem: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
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
});
