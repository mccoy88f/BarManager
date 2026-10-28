import { NotFoundException } from '@nestjs/common';
import { DisplayPromoService } from './display-promo.service';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';

describe('DisplayPromoService.getActivePlaylist', () => {
  let prisma: {
    displayPromoScreen: { findUnique: jest.Mock };
    displayPromoSchedule: { findUnique: jest.Mock };
  };
  let menuService: { getCurrentMealPeriod: jest.Mock };
  let service: DisplayPromoService;

  const defaultPlaylist = { id: 'default-playlist', name: 'Default', items: [] };
  const baseScreen = {
    id: 'screen-1',
    venue: { id: 'venue-1', active: true, displayPromoEnabled: true, timezone: 'Europe/Rome' },
    defaultPlaylist,
  };

  beforeEach(() => {
    prisma = {
      displayPromoScreen: { findUnique: jest.fn() },
      displayPromoSchedule: { findUnique: jest.fn() },
    };
    menuService = { getCurrentMealPeriod: jest.fn() };
    service = new DisplayPromoService(prisma as unknown as PrismaService, menuService as unknown as MenuService);
  });

  it('rifiuta se lo schermo non esiste', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(null);

    await expect(service.getActivePlaylist('screen-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rifiuta se il locale dello schermo non ha Display Promo attivo', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({
      ...baseScreen,
      venue: { ...baseScreen.venue, displayPromoEnabled: false },
    });

    await expect(service.getActivePlaylist('screen-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mostra la playlist programmata PER QUESTO SCHERMO per il turno corrente, quando esiste', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen);
    menuService.getCurrentMealPeriod.mockResolvedValue('LUNCH');
    const scheduledPlaylist = { id: 'lunch-playlist', name: 'Pranzo', items: [] };
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: scheduledPlaylist });

    const result = await service.getActivePlaylist('screen-1');

    expect(result).toEqual(scheduledPlaylist);
    const call = prisma.displayPromoSchedule.findUnique.mock.calls[0][0];
    expect(call.where.screenId_dayOfWeek_shift.screenId).toBe('screen-1');
    expect(call.where.screenId_dayOfWeek_shift.shift).toBe('LUNCH');
  });

  it("torna alla playlist di default DELLO SCHERMO quando il turno è pranzo/cena ma non c'è una riga di programmazione per questo giorno", async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen);
    menuService.getCurrentMealPeriod.mockResolvedValue('DINNER');
    prisma.displayPromoSchedule.findUnique.mockResolvedValue(null);

    const result = await service.getActivePlaylist('screen-1');

    expect(result).toEqual(defaultPlaylist);
  });

  it('torna alla playlist di default fuori da pranzo/cena, senza nemmeno interrogare la programmazione', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen);
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('screen-1');

    expect(result).toEqual(defaultPlaylist);
    expect(prisma.displayPromoSchedule.findUnique).not.toHaveBeenCalled();
  });

  it('torna null se non c\'è né uno slot programmato né una playlist di default per questo schermo', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, defaultPlaylist: null });
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('screen-1');

    expect(result).toBeNull();
  });

  it('due schermi dello stesso locale possono avere programmazioni/default diversi (isolamento per schermo)', async () => {
    menuService.getCurrentMealPeriod.mockResolvedValue('LUNCH');
    const playlistA = { id: 'playlist-a', name: 'Sala', items: [] };
    const playlistB = { id: 'playlist-b', name: 'Vetrina', items: [] };

    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, id: 'screen-a' });
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: playlistA });
    expect(await service.getActivePlaylist('screen-a')).toEqual(playlistA);

    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, id: 'screen-b' });
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: playlistB });
    expect(await service.getActivePlaylist('screen-b')).toEqual(playlistB);
  });
});

describe('DisplayPromoService — CRUD con isolamento per locale', () => {
  let prisma: {
    displayPromoPlaylist: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    displayPromoMedia: { findFirst: jest.Mock; create: jest.Mock };
    displayPromoScreen: { findUnique: jest.Mock; update: jest.Mock };
  };
  let service: DisplayPromoService;

  beforeEach(() => {
    prisma = {
      displayPromoPlaylist: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      displayPromoMedia: { findFirst: jest.fn(), create: jest.fn() },
      displayPromoScreen: { findUnique: jest.fn(), update: jest.fn() },
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

  it('rifiuta di modificare un display di un altro locale', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ id: 's1', venueId: 'venue-2' });

    await expect(service.updateScreen('venue-1', 's1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.displayPromoScreen.update).not.toHaveBeenCalled();
  });

  it('rifiuta di assegnare come default una playlist di un altro locale', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ id: 's1', venueId: 'venue-1' });
    prisma.displayPromoPlaylist.findUnique.mockResolvedValue({ id: 'p1', venueId: 'venue-2' });

    await expect(
      service.updateScreen('venue-1', 's1', { defaultPlaylistId: 'p1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.displayPromoScreen.update).not.toHaveBeenCalled();
  });
});
