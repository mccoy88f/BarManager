import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { MenuAvailability } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findOpenSlot, resolveOpeningHours } from '../common/opening-hours/opening-hours';
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

  /**
   * Riordina le categorie secondo l'elenco di id ricevuto (dopo un
   * drag&drop in UI): pura presentazione, permessa anche con
   * l'integrazione Loyverse attiva.
   */
  async reorderCategories(venueId: string, categoryIds: string[]) {
    const categories = await this.prisma.menuCategory.findMany({ where: { venueId } });
    if (
      categoryIds.length !== categories.length ||
      !categoryIds.every((id) => categories.some((c) => c.id === id))
    ) {
      throw new BadRequestException('Elenco categorie non valido per questo locale');
    }
    await this.prisma.$transaction(
      categoryIds.map((id, sortOrder) =>
        this.prisma.menuCategory.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    return this.listCategories(venueId);
  }

  async setCategoryVisibility(venueId: string, categoryId: string, visible: boolean) {
    const category = await this.prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    return this.prisma.menuCategory.update({ where: { id: categoryId }, data: { visible } });
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
    // Senza un sortOrder incrementale (come per le categorie), tutte le
    // voci di una categoria condividerebbero lo stesso valore di default:
    // l'ORDER BY sortOrder non avrebbe un criterio per distinguerle, e un
    // qualsiasi UPDATE successivo (es. abilitare/disabilitare) potrebbe
    // farle apparire in un ordine diverso a seconda della posizione fisica
    // delle righe nel database.
    let { sortOrder } = item;
    if (sortOrder === undefined) {
      const last = await this.prisma.menuItem.findFirst({
        where: { venueId, categoryId: item.categoryId },
        orderBy: { sortOrder: 'desc' },
      });
      sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    return this.prisma.menuItem.create({
      data: {
        ...item,
        sortOrder,
        venueId,
        variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
      },
      include: { variants: true },
    });
  }

  listItems(venueId: string, categoryId?: string) {
    return this.prisma.menuItem.findMany({
      where: { venueId, categoryId },
      // createdAt come criterio secondario: garantisce un ordine stabile
      // anche per le voci create prima di questo fix, che condividono
      // tutte sortOrder=0.
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
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
    const item = await this.prisma.menuItem.update({
      where: { id: itemId },
      data: { visible },
      include: { category: true },
    });
    // Abilitare una voce la cui categoria è nascosta la lascerebbe
    // comunque invisibile nel menù pubblico (che filtra per categoria
    // visibile): la categoria si riabilita di conseguenza.
    if (visible && !item.category.visible) {
      await this.prisma.menuCategory.update({
        where: { id: item.categoryId },
        data: { visible: true },
      });
    }
    return item;
  }

  /**
   * "In evidenza": pura presentazione (come la visibilità), permessa anche
   * con l'integrazione Loyverse attiva. Non toglie la voce dalla sua
   * categoria: la aggiunge anche alla sezione in evidenza del menù pubblico.
   */
  async setFeatured(venueId: string, itemId: string, featured: boolean) {
    await this.assertOwnership(venueId, itemId);
    return this.prisma.menuItem.update({ where: { id: itemId }, data: { featured } });
  }

  async setUnavailableUntil(venueId: string, itemId: string, until: string | null | undefined) {
    await this.assertOwnership(venueId, itemId);
    return this.prisma.menuItem.update({
      where: { id: itemId },
      data: { unavailableUntil: until ? new Date(until) : null },
    });
  }

  /** A differenza di visibilità/disponibilità, la foto segue il contenuto: con Loyverse attivo arriva da lì. */
  async setPhoto(venueId: string, itemId: string, photoUrl: string) {
    await this.assertOwnership(venueId, itemId);
    await this.assertNotLoyverseManaged(venueId);
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
   * Determina la fascia corrente (pranzo/cena/nessuna) in base agli orari
   * di apertura configurati dal locale per il giorno corrente (prima
   * fascia = "pranzo", seconda fascia opzionale = "cena"). Usa l'ora del
   * server: la gestione del fuso orario per-locale è una rifinitura
   * futura (v. roadmap).
   */
  private currentPeriod(openingHoursRaw: unknown): 'LUNCH' | 'DINNER' | 'NONE' {
    const schedule = resolveOpeningHours(openingHoursRaw);
    const now = new Date();
    const day = schedule.find((d) => d.dayOfWeek === now.getDay())!;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const slot = findOpenSlot(day, minutes);
    return slot === 1 ? 'LUNCH' : slot === 2 ? 'DINNER' : 'NONE';
  }

  async getPublicMenu(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || !venue.active) {
      throw new NotFoundException('Locale non trovato');
    }

    const period = this.currentPeriod(venue.openingHours);
    const allowedAvailabilities: MenuAvailability[] =
      period === 'LUNCH'
        ? [MenuAvailability.LUNCH, MenuAvailability.ALL_DAY]
        : period === 'DINNER'
          ? [MenuAvailability.DINNER, MenuAvailability.ALL_DAY]
          : [MenuAvailability.ALL_DAY];

    const categories = await this.prisma.menuCategory.findMany({
      where: { venueId, visible: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { visible: true, availability: { in: allowedAvailabilities } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });

    const now = new Date();
    return {
      venue: {
        name: venue.name,
        coverUrl: venue.menuCoverUrl,
        address: venue.menuAddress,
        city: venue.city,
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
            featured: item.featured,
            available: !item.unavailableUntil || item.unavailableUntil <= now,
          })),
        })),
    };
  }
}
