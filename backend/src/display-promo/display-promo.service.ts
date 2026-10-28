import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DisplayPromoMediaType, DisplayPromoShift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from '../menu/menu.service';
import { jsWeekdayInZone } from '../common/timezone/timezone';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { UpdateMediaDto } from './dto/update-media.dto';

const MEDIA_INCLUDE = { items: { orderBy: { sortOrder: 'asc' as const } } };

/**
 * Display Promo (§5.12 di DEVELOPMENT.md): playlist di foto/video per
 * schermi pubblicitari pubblici. Asse di programmazione ortogonale al
 * menù ma sugli stessi turni pranzo/cena del locale (Venue.menuMealPeriodsHours,
 * via MenuService.getCurrentMealPeriod) — nessun orario indipendente da
 * gestire qui.
 */
@Injectable()
export class DisplayPromoService {
  constructor(
    private prisma: PrismaService,
    private menuService: MenuService,
  ) {}

  // ---- Playlist ---------------------------------------------------------

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
    // su Venue.displayPromoDefaultPlaylistId se era la playlist di default.
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

  // ---- Programmazione settimanale ----------------------------------------

  listSchedule(venueId: string) {
    return this.prisma.displayPromoSchedule.findMany({ where: { venueId } });
  }

  async setScheduleSlot(
    venueId: string,
    dayOfWeek: number,
    shift: DisplayPromoShift,
    playlistId: string | null | undefined,
  ) {
    if (!playlistId) {
      await this.prisma.displayPromoSchedule.deleteMany({ where: { venueId, dayOfWeek, shift } });
      return { playlistId: null };
    }
    await this.assertPlaylistOwnership(venueId, playlistId);
    return this.prisma.displayPromoSchedule.upsert({
      where: { venueId_dayOfWeek_shift: { venueId, dayOfWeek, shift } },
      create: { venueId, dayOfWeek, shift, playlistId },
      update: { playlistId },
    });
  }

  // ---- Risoluzione per il display pubblico -------------------------------

  /**
   * Playlist da mostrare ORA per questo locale: quella assegnata al turno
   * corrente (giorno + pranzo/cena, nel fuso orario del locale) se esiste
   * una riga di programmazione, altrimenti la playlist di default — stessa
   * logica usata fuori da pranzo/cena, quando non c'è alcun turno attivo.
   */
  async getActivePlaylist(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        active: true,
        displayPromoEnabled: true,
        timezone: true,
        displayPromoDefaultPlaylist: { include: MEDIA_INCLUDE },
      },
    });
    if (!venue || !venue.active || !venue.displayPromoEnabled) {
      throw new NotFoundException('Display Promo non disponibile per questo locale');
    }

    const period = await this.menuService.getCurrentMealPeriod(venueId);
    if (period === 'LUNCH' || period === 'DINNER') {
      const dayOfWeek = jsWeekdayInZone(new Date(), venue.timezone);
      const shift = period as DisplayPromoShift;
      const slot = await this.prisma.displayPromoSchedule.findUnique({
        where: { venueId_dayOfWeek_shift: { venueId, dayOfWeek, shift } },
        include: { playlist: { include: MEDIA_INCLUDE } },
      });
      if (slot) return slot.playlist;
    }

    return venue.displayPromoDefaultPlaylist ?? null;
  }
}
