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
    showInfoBar: false,
    infoBarTheme: 'BLACK_WHITE',
    transitionEffect: 'NONE',
    venue: {
      id: 'venue-1',
      name: 'Bar Demo',
      active: true,
      displayPromoEnabled: true,
      timezone: 'Europe/Rome',
      gpsLat: null,
      gpsLng: null,
    },
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

    expect(result.playlist).toEqual(scheduledPlaylist);
    expect(result.venueName).toBe('Bar Demo');
    const call = prisma.displayPromoSchedule.findUnique.mock.calls[0][0];
    expect(call.where.screenId_dayOfWeek_shift.screenId).toBe('screen-1');
    expect(call.where.screenId_dayOfWeek_shift.shift).toBe('LUNCH');
  });

  it("torna alla playlist di default DELLO SCHERMO quando il turno è pranzo/cena ma non c'è una riga di programmazione per questo giorno", async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen);
    menuService.getCurrentMealPeriod.mockResolvedValue('DINNER');
    prisma.displayPromoSchedule.findUnique.mockResolvedValue(null);

    const result = await service.getActivePlaylist('screen-1');

    expect(result.playlist).toEqual(defaultPlaylist);
  });

  it('torna alla playlist di default fuori da pranzo/cena, senza nemmeno interrogare la programmazione', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen);
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('screen-1');

    expect(result.playlist).toEqual(defaultPlaylist);
    expect(prisma.displayPromoSchedule.findUnique).not.toHaveBeenCalled();
  });

  it('torna playlist null se non c\'è né uno slot programmato né una playlist di default per questo schermo', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, defaultPlaylist: null });
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    const result = await service.getActivePlaylist('screen-1');

    expect(result.playlist).toBeNull();
  });

  it('due schermi dello stesso locale possono avere programmazioni/default diversi (isolamento per schermo)', async () => {
    menuService.getCurrentMealPeriod.mockResolvedValue('LUNCH');
    const playlistA = { id: 'playlist-a', name: 'Sala', items: [] };
    const playlistB = { id: 'playlist-b', name: 'Vetrina', items: [] };

    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, id: 'screen-a' });
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: playlistA });
    expect((await service.getActivePlaylist('screen-a')).playlist).toEqual(playlistA);

    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, id: 'screen-b' });
    prisma.displayPromoSchedule.findUnique.mockResolvedValue({ playlist: playlistB });
    expect((await service.getActivePlaylist('screen-b')).playlist).toEqual(playlistB);
  });

  it('infoBar.enabled segue showInfoBar dello schermo, meteo presente solo se attivo e con coordinate', async () => {
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');

    prisma.displayPromoScreen.findUnique.mockResolvedValue(baseScreen); // showInfoBar: false
    expect((await service.getActivePlaylist('screen-1')).infoBar).toEqual({
      enabled: false,
      theme: 'BLACK_WHITE',
      weather: null,
    });

    prisma.displayPromoScreen.findUnique.mockResolvedValue({
      ...baseScreen,
      showInfoBar: true,
      infoBarTheme: 'GLASS',
      venue: { ...baseScreen.venue, gpsLat: 45.07, gpsLng: 7.69 },
    });
    expect((await service.getActivePlaylist('screen-1')).infoBar).toEqual({
      enabled: true,
      theme: 'GLASS',
      weather: { lat: 45.07, lng: 7.69 },
    });

    // showInfoBar attivo ma nessuna coordinata salvata per il locale: niente meteo, non un errore.
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, showInfoBar: true });
    expect((await service.getActivePlaylist('screen-1')).infoBar).toEqual({
      enabled: true,
      theme: 'BLACK_WHITE',
      weather: null,
    });
  });

  it('transitionEffect dello schermo è sempre incluso nella risposta', async () => {
    menuService.getCurrentMealPeriod.mockResolvedValue('NONE');
    prisma.displayPromoScreen.findUnique.mockResolvedValue({ ...baseScreen, transitionEffect: 'ZOOM' });

    expect((await service.getActivePlaylist('screen-1')).transitionEffect).toBe('ZOOM');
  });
});

describe('DisplayPromoService.getNewsHeadlines', () => {
  let prisma: { displayPromoScreen: { findUnique: jest.Mock } };
  let service: DisplayPromoService;

  beforeEach(() => {
    prisma = { displayPromoScreen: { findUnique: jest.fn() } };
    service = new DisplayPromoService(prisma as unknown as PrismaService, {} as unknown as MenuService);
  });

  it('rifiuta se il display non è disponibile', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue(null);

    await expect(service.getNewsHeadlines('screen-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('torna un elenco vuoto se il locale non ha configurato un feed, senza fare richieste esterne', async () => {
    prisma.displayPromoScreen.findUnique.mockResolvedValue({
      venue: { active: true, displayPromoEnabled: true, displayPromoNewsFeedUrl: null },
    });

    expect(await service.getNewsHeadlines('screen-1')).toEqual([]);
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
