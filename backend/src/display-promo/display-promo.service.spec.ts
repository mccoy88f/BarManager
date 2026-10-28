import { NotFoundException } from '@nestjs/common';
import { DisplayPromoService } from './display-promo.service';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';

describe('DisplayPromoService.getActivePlaylist', () => {
  let prisma: {
    venue: { findUnique: jest.Mock };
    displayPromoSchedule: { findUnique: jest.Mock };
  };
  let menuService: { getCurrentMealPeriod: jest.Mock };
  let service: DisplayPromoService;

  const defaultPlaylist = { id: 'default-playlist', name: 'Default', items: [] };

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn() },
      displayPromoSchedule: { findUnique: jest.fn() },
    };
    menuService = { getCurrentMealPeriod: jest.fn() };
    service = new DisplayPromoService(prisma as unknown as PrismaService, menuService as unknown as MenuService);
  });

  it('rifiuta se il locale non ha Display Promo attivo', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      active: true,
      displayPromoEnabled: false,
      timezone: 'Europe/Rome',
      displayPromoDefaultPlaylist: null,
    });

    await expect(service.getActivePlaylist('venue-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rifiuta se il locale non esiste', async () => {
    prisma.venue.findUnique.mockResolvedValue(null);

    await expect(service.getActivePlaylist('venue-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mostra la playlist programmata per il turno corrente (giorno + pranzo/cena) quando esiste', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      active: true,
      displayPromoEnabled: true,
      timezone: 'Europe/Rome',
      displayPromoDefaultPlaylist: defaultPlaylist,
    });
    menuService.getCurrentMealPeriod.mockResolvedValue('LUNCH');
    const scheduledPlaylist = { id: 'lunch-playlist', name: 'Pranzo', items: [] };
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: scheduledPlaylist });

    const result = await service.getActivePlaylist('venue-1');

    expect(result).toEqual(scheduledPlaylist);
    const call = prisma.displayPromoSchedule.findUnique.mock.calls[0][0];
    expect(call.where.venueId_dayOfWeek_shift.venueId).toBe('venue-1');
    expect(call.where.venueId_dayOfWeek_shift.shift).toBe('LUNCH');
  });

  it("torna alla playlist di default quando il turno è pranzo/cena ma non c'è una riga di programmazione per questo giorno", async () => {
    prisma.venue.findUnique.mockResolvedValue({
      active: true,
      displayPromoEnabled: true,
      timezone: 'Europe/Rome',
      displayPromoDefaultPlaylist: defaultPlaylist,
    });
    menuService.getCurrentMealPeriod.mockResolvedValue('DINNER');
    prisma.displayPromoSchedule.findUnique.mockResolvedValue(null);

    const result = await service.getActivePlaylist('venue-1');

    expect(result).toEqual(defaultPlaylist);
  });

  it('torna alla playlist di default fuori da pranzo/cena, senza nemmeno interrogare la programmazione', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      active: true,
      displayPromoEnabled: true,
      timezone: 'Europe/Rome',
      displayPromoDefaultPlaylist: defaultPlaylist,
    });
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('venue-1');

    expect(result).toEqual(defaultPlaylist);
    expect(prisma.displayPromoSchedule.findUnique).not.toHaveBeenCalled();
  });

  it('torna null se non c\'è né uno slot programmato né una playlist di default', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      active: true,
      displayPromoEnabled: true,
      timezone: 'Europe/Rome',
      displayPromoDefaultPlaylist: null,
    });
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('venue-1');

    expect(result).toBeNull();
  });
});

describe('DisplayPromoService — CRUD con isolamento per locale', () => {
  let prisma: {
    displayPromoPlaylist: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    displayPromoMedia: { findFirst: jest.Mock; create: jest.Mock };
  };
  let service: DisplayPromoService;

  beforeEach(() => {
    prisma = {
      displayPromoPlaylist: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      displayPromoMedia: { findFirst: jest.fn(), create: jest.fn() },
    };
    service = new DisplayPromoService(prisma as unknown as PrismaService, {} as unknown as MenuService);
  });

  it('rifiuta di modificare una playlist di un altro locale', async () => {
    prisma.displayPromoPlaylist.findUnique.mockResolvedValue({ id: 'p1', venueId: 'venue-2' });

    await expect(service.updatePlaylist('venue-1', 'p1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.displayPromoPlaylist.update).not.toHaveBeenCalled();
  });

  it('assegna il sortOrder successivo a un nuovo contenuto in coda alla playlist', async () => {
    prisma.displayPromoPlaylist.findUnique.mockResolvedValue({ id: 'p1', venueId: 'venue-1' });
    prisma.displayPromoMedia.findFirst.mockResolvedValue({ sortOrder: 2 });
    prisma.displayPromoMedia.create.mockResolvedValue({ id: 'm1', sortOrder: 3 });

    await service.addMedia('venue-1', 'p1', { type: 'PHOTO' as never, url: '/uploads/display-promo/x.jpg' });

    expect(prisma.displayPromoMedia.create).toHaveBeenCalledWith({
      data: { type: 'PHOTO', url: '/uploads/display-promo/x.jpg', playlistId: 'p1', sortOrder: 3 },
    });
  });
});
