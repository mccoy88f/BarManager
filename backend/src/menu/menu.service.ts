import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { MenuAvailability } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

@Injectable()
export class MenuService {
  constructor(private prisma: PrismaService) {}

  /**
   * Con l'integrazione Loyverse attiva il catalogo (categorie, voci,
   * prezzi) è gestito esclusivamente da lì: qui blocchiamo le modifiche
   * manuali "di contenuto". Restano sempre permesse le operazioni di sola
   * presentazione (visibilità, disponibilità, riordino categorie, foto),
   * che sync.ts (motore di sincronizzazione) non tocca mai.
   */
  private async assertNotLoyverseManaged(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { loyverseIntegrationEnabled: true },
    });
    if (venue?.loyverseIntegrationEnabled) {
      throw new BadRequestException(
        "Il menù è gestito da Loyverse: modifica prodotti, prezzi e categorie da lì. Qui puoi solo decidere cosa mostrare online.",
      );
    }
  }

  // ---- Categorie ------------------------------------------------------

  async createCategory(venueId: string, dto: CreateMenuCategoryDto) {
    await this.assertNotLoyverseManaged(venueId);
    let { sortOrder } = dto;
    if (sortOrder === undefined) {
      const last = await this.prisma.menuCategory.findFirst({
        where: { venueId },
        orderBy: { sortOrder: 'desc' },
      });
      sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    return this.prisma.menuCategory.create({ data: { ...dto, sortOrder, venueId } });
  }

  listCategories(venueId: string) {
    return this.prisma.menuCategory.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
      include: { items: true },
    });
  }

  /** Sposta una categoria su/giù scambiando l'ordinamento con la vicina. */
  async moveCategory(venueId: string, categoryId: string, direction: 'up' | 'down') {
    const categories = await this.prisma.menuCategory.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
    });
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index === -1) {
      throw new NotFoundException('Categoria non trovata');
    }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= categories.length) {
      return categories; // già in cima/fondo: nessuna modifica
    }
    const current = categories[index];
    const neighbor = categories[neighborIndex];
    await this.prisma.$transaction([
      this.prisma.menuCategory.update({
        where: { id: current.id },
        data: { sortOrder: neighbor.sortOrder },
      }),
      this.prisma.menuCategory.update({
        where: { id: neighbor.id },
        data: { sortOrder: current.sortOrder },
      }),
    ]);
    return this.listCategories(venueId);
  }

  async updateCategory(venueId: string, categoryId: string, dto: UpdateMenuCategoryDto) {
    await this.assertNotLoyverseManaged(venueId);
    const category = await this.prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    return this.prisma.menuCategory.update({ where: { id: categoryId }, data: dto });
  }

  async removeCategory(venueId: string, categoryId: string) {
    await this.assertNotLoyverseManaged(venueId);
    const category = await this.prisma.menuCategory.findUnique({
      where: { id: categoryId },
      include: { items: true },
    });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    if (category.items.length > 0) {
      throw new BadRequestException(
        'Rimuovi prima le voci di menù di questa categoria per poterla eliminare',
      );
    }
    await this.prisma.menuCategory.delete({ where: { id: categoryId } });
    return { success: true };
  }

  // ---- Voci di menù (amministrazione) ------------------------------------

  async createItem(venueId: string, dto: CreateMenuItemDto) {
    await this.assertNotLoyverseManaged(venueId);
    const { variants, ...item } = dto;
    return this.prisma.menuItem.create({
      data: {
        ...item,
        venueId,
        variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
      },
      include: { variants: true },
    });
  }

  listItems(venueId: string, categoryId?: string) {
    return this.prisma.menuItem.findMany({
      where: { venueId, categoryId },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
      include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Le varianti si sostituiscono sempre tutte insieme quando arrivano nel
   * corpo della richiesta: il form admin invia l'elenco completo a ogni
   * salvataggio, non serve una patch riga-per-riga.
   */
  async updateItem(venueId: string, itemId: string, dto: UpdateMenuItemDto) {
    await this.assertOwnership(venueId, itemId);
    if (dto.name !== undefined || dto.categoryId !== undefined || dto.variants !== undefined) {
      await this.assertNotLoyverseManaged(venueId);
    }
    const { variants, ...item } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (variants) {
        await tx.menuItemVariant.deleteMany({ where: { menuItemId: itemId } });
      }
      return tx.menuItem.update({
        where: { id: itemId },
        data: {
          ...item,
          ...(variants && {
            variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
          }),
        },
        include: { variants: true },
      });
    });
  }

  async setVisibility(venueId: string, itemId: string, visible: boolean) {
    await this.assertOwnership(venueId, itemId);
    return this.prisma.menuItem.update({ where: { id: itemId }, data: { visible } });
  }

  async setUnavailableUntil(venueId: string, itemId: string, until: string | null | undefined) {
    await this.assertOwnership(venueId, itemId);
    return this.prisma.menuItem.update({
      where: { id: itemId },
      data: { unavailableUntil: until ? new Date(until) : null },
    });
  }

  async setPhoto(venueId: string, itemId: string, photoUrl: string) {
    await this.assertOwnership(venueId, itemId);
    return this.prisma.menuItem.update({ where: { id: itemId }, data: { photoUrl } });
  }

  async deleteItem(venueId: string, itemId: string) {
    await this.assertOwnership(venueId, itemId);
    await this.assertNotLoyverseManaged(venueId);
    return this.prisma.menuItem.delete({ where: { id: itemId } });
  }

  private async assertOwnership(venueId: string, itemId: string) {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId } });
    if (!item || item.venueId !== venueId) {
      throw new NotFoundException('Voce di menù non trovata');
    }
    return item;
  }

  // ---- Menù pubblico (nessun login) --------------------------------------

  /**
   * Determina la fascia corrente (pranzo/cena/nessuna) in base all'orario
   * configurato dal locale. Usa l'ora del server: la gestione del fuso
   * orario per-locale è una rifinitura futura (v. roadmap).
   */
  private currentPeriod(venue: {
    lunchStart: string;
    lunchEnd: string;
    dinnerStart: string;
    dinnerEnd: string;
  }): 'LUNCH' | 'DINNER' | 'NONE' {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };

    if (minutes >= toMinutes(venue.lunchStart) && minutes <= toMinutes(venue.lunchEnd)) {
      return 'LUNCH';
    }
    if (minutes >= toMinutes(venue.dinnerStart) && minutes <= toMinutes(venue.dinnerEnd)) {
      return 'DINNER';
    }
    return 'NONE';
  }

  async getPublicMenu(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || !venue.active) {
      throw new NotFoundException('Locale non trovato');
    }

    const period = this.currentPeriod(venue);
    const allowedAvailabilities: MenuAvailability[] =
      period === 'LUNCH'
        ? [MenuAvailability.LUNCH, MenuAvailability.ALL_DAY]
        : period === 'DINNER'
          ? [MenuAvailability.DINNER, MenuAvailability.ALL_DAY]
          : [MenuAvailability.ALL_DAY];

    const categories = await this.prisma.menuCategory.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { visible: true, availability: { in: allowedAvailabilities } },
          orderBy: { sortOrder: 'asc' },
          include: { variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });

    const now = new Date();
    return {
      venue: {
        name: venue.name,
        coverUrl: venue.menuCoverUrl,
        phone: venue.menuPhone,
        instagramUrl: venue.menuInstagramUrl,
        facebookUrl: venue.menuFacebookUrl,
        websiteUrl: venue.menuWebsiteUrl,
      },
      categories: categories
        .filter((c) => c.items.length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          items: c.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            variants: item.variants.map((v) => ({ id: v.id, name: v.name, price: v.price })),
            photoUrl: item.photoUrl,
            allergens: item.allergens,
            available: !item.unavailableUntil || item.unavailableUntil <= now,
          })),
        })),
    };
  }
}
