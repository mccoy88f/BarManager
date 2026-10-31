import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DisplayPromoMediaType, DisplayPromoShift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';
import { jsWeekdayInZone } from '../common/timezone/timezone';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { CreateScreenDto } from './dto/create-screen.dto';
import { UpdateScreenDto } from './dto/update-screen.dto';
import { fetchHeadlines } from '../common/news/rss';
import { venuePublicUrl } from '../common/venue-url/venue-url';

function generatePairingCode(): string {
  // Caratteri univoci e facilmente leggibili da TV (nessuna ambiguità 0/O, 1/I)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeKioskCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const MEDIA_INCLUDE = { items: { orderBy: { sortOrder: 'asc' as const } } };

/**
 * Display Promo (§5.12 di DEVELOPMENT.md): playlist di foto/video per
 * schermi pubblicitari pubblici. Un locale può avere più display fisici
 * (DisplayPromoScreen) diversi, ciascuno con la propria programmazione;
 * le playlist (pool di contenuti) sono invece condivise per locale, un
 * asse ortogonale a quello degli schermi. Programmazione sugli stessi
 * turni pranzo/cena del locale (Venue.menuMealPeriodsHours, via
 * MenuService.getCurrentMealPeriod) — nessun orario indipendente da
 * gestire qui.
 */
@Injectable()
export class DisplayPromoService {
  constructor(
    private prisma: PrismaService,
    private menuService: MenuService,
  ) {}

  // ---- Playlist (pool di contenuti condiviso per locale) ----------------

  createPlaylist(venueId: string, dto: CreatePlaylistDto) {
    return this.prisma.displayPromoPlaylist.create({
      data: { venueId, name: dto.name },
      include: MEDIA_INCLUDE,
    });
  }

  listPlaylists(venueId: string) {
    return this.prisma.displayPromoPlaylist.findMany({
      where: { venueId },
      orderBy: { createdAt: 'asc' },
      include: MEDIA_INCLUDE,
    });
  }

  private async assertPlaylistOwnership(venueId: string, playlistId: string) {
    const playlist = await this.prisma.displayPromoPlaylist.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.venueId !== venueId) throw new NotFoundException('Playlist non trovata');
    return playlist;
  }

  async updatePlaylist(venueId: string, playlistId: string, dto: UpdatePlaylistDto) {
    await this.assertPlaylistOwnership(venueId, playlistId);
    return this.prisma.displayPromoPlaylist.update({
      where: { id: playlistId },
      data: dto,
      include: MEDIA_INCLUDE,
    });
  }

  async removePlaylist(venueId: string, playlistId: string) {
    await this.assertPlaylistOwnership(venueId, playlistId);
    // onDelete: Cascade su DisplayPromoMedia/DisplayPromoSchedule, SetNull
    // su DisplayPromoScreen.defaultPlaylistId se era la playlist di default
    // di uno o più schermi.
    await this.prisma.displayPromoPlaylist.delete({ where: { id: playlistId } });
    return { success: true };
  }

  // ---- Contenuti (foto/video) --------------------------------------------

  async addMedia(
    venueId: string,
    playlistId: string,
    data: { type: DisplayPromoMediaType; url: string },
  ) {
    await this.assertPlaylistOwnership(venueId, playlistId);
    const last = await this.prisma.displayPromoMedia.findFirst({
      where: { playlistId },
      orderBy: { sortOrder: 'desc' },
    });
    return this.prisma.displayPromoMedia.create({
      data: { ...data, playlistId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
  }

  private async assertMediaOwnership(venueId: string, mediaId: string) {
    const media = await this.prisma.displayPromoMedia.findUnique({
      where: { id: mediaId },
      include: { playlist: true },
    });
    if (!media || media.playlist.venueId !== venueId) throw new NotFoundException('Contenuto non trovato');
    return media;
  }

  async updateMedia(venueId: string, mediaId: string, dto: UpdateMediaDto) {
    await this.assertMediaOwnership(venueId, mediaId);
    return this.prisma.displayPromoMedia.update({ where: { id: mediaId }, data: dto });
  }

  async removeMedia(venueId: string, mediaId: string) {
    await this.assertMediaOwnership(venueId, mediaId);
    await this.prisma.displayPromoMedia.delete({ where: { id: mediaId } });
    return { success: true };
  }

  /** Il client invia sempre l'elenco completo degli id nel nuovo ordine, come il riordino categorie del menù. */
  async reorderMedia(venueId: string, playlistId: string, mediaIds: string[]) {
    const playlist = await this.prisma.displayPromoPlaylist.findUnique({
      where: { id: playlistId },
      include: { items: true },
    });
    if (!playlist || playlist.venueId !== venueId) throw new NotFoundException('Playlist non trovata');
    const currentIds = new Set(playlist.items.map((i) => i.id));
    if (mediaIds.length !== currentIds.size || !mediaIds.every((id) => currentIds.has(id))) {
      throw new BadRequestException('L\'elenco deve contenere esattamente i contenuti già nella playlist');
    }
    await this.prisma.$transaction(
      mediaIds.map((id, sortOrder) => this.prisma.displayPromoMedia.update({ where: { id }, data: { sortOrder } })),
    );
    return { success: true };
  }

  // ---- Display (schermi fisici) ------------------------------------------

  createScreen(venueId: string, dto: CreateScreenDto) {
    return this.prisma.displayPromoScreen.create({ data: { venueId, name: dto.name } });
  }

  listScreens(venueId: string) {
    return this.prisma.displayPromoScreen.findMany({
      where: { venueId },
      orderBy: { createdAt: 'asc' },
      include: { schedules: true },
    });
  }

  private async assertScreenOwnership(venueId: string, screenId: string) {
    const screen = await this.prisma.displayPromoScreen.findUnique({ where: { id: screenId } });
    if (!screen || screen.venueId !== venueId) throw new NotFoundException('Display non trovato');
    return screen;
  }

  async updateScreen(venueId: string, screenId: string, dto: UpdateScreenDto) {
    await this.assertScreenOwnership(venueId, screenId);
    if (dto.defaultPlaylistId) await this.assertPlaylistOwnership(venueId, dto.defaultPlaylistId);
    return this.prisma.displayPromoScreen.update({ where: { id: screenId }, data: dto });
  }

  async setHeaderLogo(venueId: string, screenId: string, headerLogoUrl: string) {
    await this.assertScreenOwnership(venueId, screenId);
    return this.prisma.displayPromoScreen.update({ where: { id: screenId }, data: { headerLogoUrl } });
  }

  async removeScreen(venueId: string, screenId: string) {
    await this.assertScreenOwnership(venueId, screenId);
    // onDelete: Cascade su DisplayPromoSchedule di questo schermo.
    await this.prisma.displayPromoScreen.delete({ where: { id: screenId } });
    return { success: true };
  }

  // ---- Programmazione settimanale di un singolo schermo ------------------

  async listSchedule(venueId: string, screenId: string) {
    await this.assertScreenOwnership(venueId, screenId);
    return this.prisma.displayPromoSchedule.findMany({ where: { screenId } });
  }

  async setScheduleSlot(
    venueId: string,
    screenId: string,
    dayOfWeek: number,
    shift: DisplayPromoShift,
    playlistId: string | null | undefined,
  ) {
    await this.assertScreenOwnership(venueId, screenId);
    if (!playlistId) {
      await this.prisma.displayPromoSchedule.deleteMany({ where: { screenId, dayOfWeek, shift } });
      return { playlistId: null };
    }
    await this.assertPlaylistOwnership(venueId, playlistId);
    return this.prisma.displayPromoSchedule.upsert({
      where: { screenId_dayOfWeek_shift: { screenId, dayOfWeek, shift } },
      create: { screenId, dayOfWeek, shift, playlistId },
      update: { playlistId },
    });
  }

  // ---- Risoluzione per il display pubblico -------------------------------

  /**
   * Playlist da mostrare ORA su questo schermo: quella assegnata al turno
   * corrente (giorno + pranzo/cena, nel fuso orario del locale) se esiste
   * una riga di programmazione per QUESTO schermo, altrimenti la playlist
   * di default DELLO STESSO SCHERMO — stessa logica usata fuori da
   * pranzo/cena, quando non c'è alcun turno attivo. L'id dello schermo
   * identifica già il locale: nessuna risoluzione per sottodominio
   * necessaria, a differenza delle altre pagine pubbliche. Include anche
   * nome locale e, se questo schermo ha la fascia "da telegiornale"
   * attiva, le coordinate per il meteo (chiamato direttamente dal
   * frontend a Open-Meteo, nessun proxy backend necessario) — il ticker
   * notizie passa invece da getNewsHeadlines sotto, perché un feed RSS non
   * si può leggere da browser per CORS.
   */
  async getActivePlaylist(screenId: string) {
    const screen = await this.prisma.displayPromoScreen.findUnique({
      where: { id: screenId },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            active: true,
            displayPromoEnabled: true,
            timezone: true,
            gpsLat: true,
            gpsLng: true,
          },
        },
        defaultPlaylist: { include: MEDIA_INCLUDE },
      },
    });
    if (!screen || !screen.venue.active || !screen.venue.displayPromoEnabled) {
      throw new NotFoundException('Display non disponibile');
    }

    const period = await this.menuService.getCurrentMealPeriod(screen.venue.id);
    let playlist = screen.defaultPlaylist ?? null;
    if (period === 'LUNCH' || period === 'DINNER') {
      const dayOfWeek = jsWeekdayInZone(new Date(), screen.venue.timezone);
      const shift = period as DisplayPromoShift;
      const slot = await this.prisma.displayPromoSchedule.findUnique({
        where: { screenId_dayOfWeek_shift: { screenId, dayOfWeek, shift } },
        include: { playlist: { include: MEDIA_INCLUDE } },
      });
      if (slot) playlist = slot.playlist;
    }

    return {
      venueName: screen.venue.name,
      // Precedenza: logo > testo personalizzato > nome del locale (gestita lato frontend, qui solo i dati grezzi).
      headerText: screen.headerText,
      headerLogoUrl: screen.headerLogoUrl,
      playlist,
      transitionEffect: screen.transitionEffect,
      infoBar: {
        enabled: screen.showInfoBar,
        theme: screen.infoBarTheme,
        weather:
          screen.showInfoBar && screen.venue.gpsLat != null && screen.venue.gpsLng != null
            ? { lat: screen.venue.gpsLat, lng: screen.venue.gpsLng }
            : null,
      },
    };
  }

  /**
   * Titoli dal feed RSS del locale (impostazione condivisa da tutti i
   * suoi schermi, §5.12): array vuoto se non configurato o irraggiungibile
   * — mai un errore, il ticker semplicemente non mostra nulla.
   */
  async getNewsHeadlines(screenId: string): Promise<string[]> {
    const screen = await this.prisma.displayPromoScreen.findUnique({
      where: { id: screenId },
      include: { venue: { select: { active: true, displayPromoEnabled: true, displayPromoNewsFeedUrl: true } } },
    });
    if (!screen || !screen.venue.active || !screen.venue.displayPromoEnabled) {
      throw new NotFoundException('Display non disponibile');
    }
    if (!screen.venue.displayPromoNewsFeedUrl) return [];
    return fetchHeadlines(screen.venue.displayPromoNewsFeedUrl);
  }

  // ---- Kiosk Android (BarManager Kiosk, abbinamento codici schermo) -------

  /**
   * Registrazione o aggiornamento di un dispositivo Kiosk fisico.
   * Se ha già un deviceId memorizzato e associato a uno schermo attivo,
   * restituisce subito lo stato PAIRED con l'URL definitivo; altrimenti
   * assegna un codice di abbinamento univoco a 6 caratteri da mostrare a schermo.
   */
  async registerKioskDevice(data: {
    deviceId?: string;
    deviceInfo?: string;
    appVersion?: string;
    ipAddress?: string;
    code?: string;
  }) {
    if (data.deviceId) {
      const existing = await this.prisma.displayPromoKioskDevice.findFirst({
        where: { deviceId: data.deviceId },
        include: {
          screen: {
            include: {
              venue: { select: { id: true, slug: true, active: true, displayPromoEnabled: true } },
            },
          },
        },
      });

      if (existing) {
        await this.prisma.displayPromoKioskDevice.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(),
            deviceInfo: data.deviceInfo ?? existing.deviceInfo,
            appVersion: data.appVersion ?? existing.appVersion,
            ipAddress: data.ipAddress ?? existing.ipAddress,
          },
        });

        if (existing.screen && existing.screen.venue.active && existing.screen.venue.displayPromoEnabled) {
          return {
            status: 'PAIRED' as const,
            code: existing.code,
            screenId: existing.screen.id,
            screenName: existing.screen.name,
            screenUrl: venuePublicUrl(existing.screen.venue, `/display/${existing.screen.id}`),
          };
        }

        return {
          status: 'PENDING' as const,
          code: existing.code,
          pollIntervalMs: 3000,
        };
      }
    }

    // Se il client propone un codice valido usalo se non occupato, altrimenti generalo
    let code = data.code ? normalizeKioskCode(data.code) : '';
    if (code) {
      const collision = await this.prisma.displayPromoKioskDevice.findUnique({ where: { code } });
      if (collision) code = '';
    }

    if (!code) {
      let attempts = 0;
      while (attempts < 10) {
        const candidate = generatePairingCode();
        const collision = await this.prisma.displayPromoKioskDevice.findUnique({ where: { code: candidate } });
        if (!collision) {
          code = candidate;
          break;
        }
        attempts++;
      }
      if (!code) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
      }
    }

    const created = await this.prisma.displayPromoKioskDevice.create({
      data: {
        code,
        deviceId: data.deviceId,
        deviceInfo: data.deviceInfo,
        appVersion: data.appVersion,
        ipAddress: data.ipAddress,
      },
    });

    return {
      status: 'PENDING' as const,
      code: created.code,
      pollIntervalMs: 3000,
    };
  }

  /**
   * Polling periodico dell'app Kiosk durante la schermata con il codice.
   * Quando l'admin inserisce il codice nel pannello Display Promo, il
   * dispositivo riceve PAIRED e l'URL a cui agganciarsi.
   */
  async getKioskStatus(params: { code?: string; deviceId?: string; ipAddress?: string }) {
    const normalizedCode = params.code ? normalizeKioskCode(params.code) : undefined;
    const device = await this.prisma.displayPromoKioskDevice.findFirst({
      where: {
        OR: [
          ...(normalizedCode ? [{ code: normalizedCode }] : []),
          ...(params.deviceId ? [{ deviceId: params.deviceId }] : []),
        ],
      },
      include: {
        screen: {
          include: {
            venue: { select: { id: true, slug: true, active: true, displayPromoEnabled: true } },
          },
        },
      },
    });

    if (!device) {
      return { status: 'NOT_FOUND' as const };
    }

    await this.prisma.displayPromoKioskDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ipAddress: params.ipAddress ?? device.ipAddress,
      },
    });

    if (device.screen && device.screen.venue.active && device.screen.venue.displayPromoEnabled) {
      return {
        status: 'PAIRED' as const,
        code: device.code,
        screenId: device.screen.id,
        screenName: device.screen.name,
        screenUrl: venuePublicUrl(device.screen.venue, `/display/${device.screen.id}`),
      };
    }

    return {
      status: 'PENDING' as const,
      code: device.code,
      pollIntervalMs: 3000,
    };
  }

  /**
   * Heartbeat periodico dall'app mentre proietta il display promo:
   * se l'admin scollega lo schermo dal backoffice, restituisce UNPAIRED
   * così l'app azzera la configurazione e torna alla schermata del codice.
   */
  async kioskHeartbeat(params: { code?: string; deviceId?: string; ipAddress?: string }) {
    const normalizedCode = params.code ? normalizeKioskCode(params.code) : undefined;
    const device = await this.prisma.displayPromoKioskDevice.findFirst({
      where: {
        OR: [
          ...(normalizedCode ? [{ code: normalizedCode }] : []),
          ...(params.deviceId ? [{ deviceId: params.deviceId }] : []),
        ],
      },
      include: {
        screen: {
          include: {
            venue: { select: { id: true, slug: true, active: true, displayPromoEnabled: true } },
          },
        },
      },
    });

    if (!device || !device.screen || !device.screen.venue.active || !device.screen.venue.displayPromoEnabled) {
      return { status: 'UNPAIRED' as const, code: device?.code };
    }

    await this.prisma.displayPromoKioskDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ipAddress: params.ipAddress ?? device.ipAddress,
      },
    });

    return {
      status: 'PAIRED' as const,
      code: device.code,
      screenId: device.screen.id,
      screenName: device.screen.name,
      screenUrl: venuePublicUrl(device.screen.venue, `/display/${device.screen.id}`),
    };
  }

  /** L'app kiosk stessa richiede lo scollegamento (es. tramite menu segreto dell'app su TV). */
  async kioskUnpairSelf(params: { code?: string; deviceId?: string }) {
    const normalizedCode = params.code ? normalizeKioskCode(params.code) : undefined;
    const device = await this.prisma.displayPromoKioskDevice.findFirst({
      where: {
        OR: [
          ...(normalizedCode ? [{ code: normalizedCode }] : []),
          ...(params.deviceId ? [{ deviceId: params.deviceId }] : []),
        ],
      },
    });

    if (device) {
      await this.prisma.displayPromoKioskDevice.update({
        where: { id: device.id },
        data: { screenId: null },
      });
    }

    return { success: true, status: 'UNPAIRED' as const };
  }

  // ---- Gestione Admin dei dispositivi Kiosk collegati a uno schermo --------

  async listKiosksForScreen(venueId: string, screenId: string) {
    await this.assertScreenOwnership(venueId, screenId);
    return this.prisma.displayPromoKioskDevice.findMany({
      where: { screenId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        deviceId: true,
        deviceInfo: true,
        ipAddress: true,
        appVersion: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }

  async pairKioskToScreen(
    venueId: string,
    screenId: string,
    dto: { code: string; name?: string },
  ) {
    await this.assertScreenOwnership(venueId, screenId);
    const code = normalizeKioskCode(dto.code);
    if (!code) throw new BadRequestException('Codice non valido');

    // Se esiste già il dispositivo con quel codice registrato dall'app Android:
    const existing = await this.prisma.displayPromoKioskDevice.findUnique({ where: { code } });
    if (existing) {
      return this.prisma.displayPromoKioskDevice.update({
        where: { id: existing.id },
        data: {
          screenId,
          name: dto.name?.trim() || existing.name,
        },
      });
    }

    // Se l'admin digita un codice non ancora registrato: crealo già pre-collegato
    return this.prisma.displayPromoKioskDevice.create({
      data: {
        code,
        screenId,
        name: dto.name?.trim() || null,
      },
    });
  }

  async unlinkKioskFromScreen(venueId: string, screenId: string, deviceIdOrCode: string) {
    await this.assertScreenOwnership(venueId, screenId);
    const normalized = normalizeKioskCode(deviceIdOrCode);
    const device = await this.prisma.displayPromoKioskDevice.findFirst({
      where: {
        screenId,
        OR: [
          { id: deviceIdOrCode },
          { code: normalized },
        ],
      },
    });
    if (!device) {
      throw new NotFoundException('Dispositivo kiosk non trovato per questo schermo');
    }

    await this.prisma.displayPromoKioskDevice.update({
      where: { id: device.id },
      data: { screenId: null },
    });

    return { success: true };
  }
}
