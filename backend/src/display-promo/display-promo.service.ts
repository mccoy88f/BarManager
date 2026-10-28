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
   * necessaria, a differenza delle altre pagine pubbliche.
   */
  async getActivePlaylist(screenId: string) {
    const screen = await this.prisma.displayPromoScreen.findUnique({
      where: { id: screenId },
      include: {
        venue: { select: { id: true, active: true, displayPromoEnabled: true, timezone: true } },
        defaultPlaylist: { include: MEDIA_INCLUDE },
      },
    });
    if (!screen || !screen.venue.active || !screen.venue.displayPromoEnabled) {
      throw new NotFoundException('Display non disponibile');
    }

    const period = await this.menuService.getCurrentMealPeriod(screen.venue.id);
    if (period === 'LUNCH' || period === 'DINNER') {
      const dayOfWeek = jsWeekdayInZone(new Date(), screen.venue.timezone);
      const shift = period as DisplayPromoShift;
      const slot = await this.prisma.displayPromoSchedule.findUnique({
        where: { screenId_dayOfWeek_shift: { screenId, dayOfWeek, shift } },
        include: { playlist: { include: MEDIA_INCLUDE } },
      });
      if (slot) return slot.playlist;
    }

    return screen.defaultPlaylist ?? null;
  }
}
