import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { Allergen, MenuAvailability } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { XlsxService } from '../reports/xlsx.service';
import {
  applyDayOverride,
  DayOverride,
  findOpenSlot,
  resolveOpeningHours,
  specialDayKey,
} from '../common/opening-hours/opening-hours';
import { dateOnlyInZone, jsWeekdayInZone, minutesOfDayInZone } from '../common/timezone/timezone';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { CreateMenuModifierGroupDto } from './dto/create-menu-modifier-group.dto';
import { UpdateMenuModifierGroupDto } from './dto/update-menu-modifier-group.dto';

// Stesse etichette italiane mostrate in MenuAdmin.tsx (availabilityLabels/
// allergenLabels): usate qui per esportare/importare in xlsx con lo stesso
// vocabolario visto in pagina, invece dei valori enum grezzi in inglese.
const AVAILABILITY_LABELS: Record<MenuAvailability, string> = {
  LUNCH: 'Solo pranzo',
  DINNER: 'Solo cena',
  ALL_DAY: 'Tutto il giorno',
};
const AVAILABILITY_BY_LABEL = new Map(
  Object.entries(AVAILABILITY_LABELS).map(([value, label]) => [label.toLowerCase(), value as MenuAvailability]),
);

const ALLERGEN_LABELS: Record<Allergen, string> = {
  GLUTEN: 'Glutine',
  CRUSTACEANS: 'Crostacei',
  EGGS: 'Uova',
  FISH: 'Pesce',
  PEANUTS: 'Arachidi',
  SOYBEANS: 'Soia',
  MILK: 'Latte',
  NUTS: 'Frutta a guscio',
  CELERY: 'Sedano',
  MUSTARD: 'Senape',
  SESAME: 'Sesamo',
  SULPHITES: 'Solfiti',
  LUPIN: 'Lupini',
  MOLLUSCS: 'Molluschi',
};
const ALLERGEN_BY_LABEL = new Map(
  Object.entries(ALLERGEN_LABELS).map(([value, label]) => [label.toLowerCase(), value as Allergen]),
);

const IMPORT_COLUMNS = {
  itemId: 'ID voce',
  category: 'Categoria',
  name: 'Nome',
  description: 'Descrizione',
  availability: 'Disponibilità',
  allergens: 'Allergeni',
  featured: 'In evidenza',
  visible: 'Visibile',
  variantName: 'Variante',
  price: 'Prezzo',
  variantActive: 'Variante attiva',
} as const;

function cellToString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  const str = cellToString(value);
  if (!str) return undefined;
  const num = Number(str);
  return Number.isNaN(num) ? undefined : num;
}

function cellToBoolean(value: unknown, defaultValue: boolean): boolean {
  const str = cellToString(value);
  if (!str) return defaultValue;
  return str.toUpperCase() === 'SI' || str.toUpperCase() === 'SÌ' || str.toUpperCase() === 'YES';
}

@Injectable()
export class MenuService {
  constructor(
    private prisma: PrismaService,
    private xlsx: XlsxService,
  ) {}

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

  /** Canale ordini online (§5.10): flag di presentazione come "visible", non tocca il menù locale. */
  async setCategoryOrderableOnline(venueId: string, categoryId: string, orderableOnline: boolean) {
    const category = await this.prisma.menuCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    return this.prisma.menuCategory.update({ where: { id: categoryId }, data: { orderableOnline } });
  }

  /**
   * Scorciatoia richiesta dall'admin (§5.10): attiva "ordinabile online"
   * per tutte le categorie/voci già visibili sul menù, senza doverlo fare
   * una per una nel dialog di modifica. Solo additiva (mai un
   * "azzeramento"): non tocca chi ha già orderableOnline=true, né
   * disattiva chi non è visibile.
   */
  async syncOrderableOnlineFromVisible(venueId: string): Promise<{ categories: number; items: number }> {
    const categories = await this.prisma.menuCategory.updateMany({
      where: { venueId, visible: true, orderableOnline: false },
      data: { orderableOnline: true },
    });
    const items = await this.prisma.menuItem.updateMany({
      where: { venueId, visible: true, orderableOnline: false },
      data: { orderableOnline: true },
    });
    return { categories: categories.count, items: items.count };
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
    const { variants, modifierGroupIds, ...item } = dto;
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
        ...(modifierGroupIds && {
          modifierGroups: { create: modifierGroupIds.map((modifierGroupId) => ({ modifierGroupId })) },
        }),
      },
      include: { variants: true, modifierGroups: { include: { modifierGroup: { include: { options: true } } } } },
    });
  }

  listItems(venueId: string, categoryId?: string) {
    return this.prisma.menuItem.findMany({
      where: { venueId, categoryId },
      // createdAt come criterio secondario: garantisce un ordine stabile
      // anche per le voci create prima di questo fix, che condividono
      // tutte sortOrder=0.
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        category: true,
        variants: { orderBy: { sortOrder: 'asc' } },
        modifierGroups: { include: { modifierGroup: { include: { options: true } } } },
      },
    });
  }

  /**
   * Le varianti (e i gruppi di modificatori assegnati) si sostituiscono
   * sempre tutti insieme quando arrivano nel corpo della richiesta: il
   * form admin invia l'elenco completo a ogni salvataggio, non serve una
   * patch riga-per-riga.
   */
  async updateItem(venueId: string, itemId: string, dto: UpdateMenuItemDto) {
    await this.assertOwnership(venueId, itemId);
    if (dto.name !== undefined || dto.categoryId !== undefined || dto.variants !== undefined) {
      await this.assertNotLoyverseManaged(venueId);
    }
    const { variants, modifierGroupIds, ...item } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (variants) {
        await tx.menuItemVariant.deleteMany({ where: { menuItemId: itemId } });
      }
      if (modifierGroupIds) {
        await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId: itemId } });
      }
      return tx.menuItem.update({
        where: { id: itemId },
        data: {
          ...item,
          ...(variants && {
            variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
          }),
          ...(modifierGroupIds && {
            modifierGroups: { create: modifierGroupIds.map((modifierGroupId) => ({ modifierGroupId })) },
          }),
        },
        include: { variants: true, modifierGroups: { include: { modifierGroup: { include: { options: true } } } } },
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

  // ---- Import/export xlsx ------------------------------------------------

  /**
   * Esporta le voci di menù in xlsx, stesso formato accettato da
   * importXlsx: una riga per ogni variante (quasi sempre una sola per
   * voce), con le colonne della voce (categoria, nome, descrizione, ecc.)
   * ripetute su ogni riga — permette di rappresentare in un foglio piatto
   * anche le voci con più varianti (es. "Piccola"/"Grande"). Disponibile
   * sempre, anche con l'integrazione Loyverse attiva (a differenza
   * dell'importazione): utile anche solo per avere un elenco leggibile.
   */
  async exportXlsx(venueId: string): Promise<Buffer> {
    const items = await this.prisma.menuItem.findMany({
      where: { venueId },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { category: true, variants: { orderBy: { sortOrder: 'asc' } } },
    });

    const rows = items.flatMap((item) =>
      item.variants.map((variant) => ({
        itemId: item.id,
        category: item.category.name,
        name: item.name,
        description: item.description ?? '',
        availability: AVAILABILITY_LABELS[item.availability],
        allergens: item.allergens.map((a) => ALLERGEN_LABELS[a]).join(', '),
        featured: item.featured ? 'SI' : 'NO',
        visible: item.visible ? 'SI' : 'NO',
        variantName: variant.name,
        price: variant.price ?? '',
        variantActive: variant.active ? 'SI' : 'NO',
      })),
    );

    return this.xlsx.buildSheet(
      'Menù',
      [
        { header: IMPORT_COLUMNS.itemId, key: 'itemId', width: 28 },
        { header: IMPORT_COLUMNS.category, key: 'category', width: 20 },
        { header: IMPORT_COLUMNS.name, key: 'name', width: 24 },
        { header: IMPORT_COLUMNS.description, key: 'description', width: 40 },
        { header: IMPORT_COLUMNS.availability, key: 'availability', width: 16 },
        { header: IMPORT_COLUMNS.allergens, key: 'allergens', width: 30 },
        { header: IMPORT_COLUMNS.featured, key: 'featured', width: 12 },
        { header: IMPORT_COLUMNS.visible, key: 'visible', width: 12 },
        { header: IMPORT_COLUMNS.variantName, key: 'variantName', width: 18 },
        { header: IMPORT_COLUMNS.price, key: 'price', width: 12 },
        { header: IMPORT_COLUMNS.variantActive, key: 'variantActive', width: 14 },
      ],
      rows,
    );
  }

  /**
   * Importa/aggiorna voci di menù da xlsx (stesso formato di exportXlsx):
   * le righe vengono raggruppate per voce (per "ID voce" quando presente,
   * altrimenti per categoria+nome) e le varianti di ogni gruppo
   * sostituiscono sempre tutte insieme quelle esistenti, come già fa
   * updateItem da UI. Mai permessa con l'integrazione Loyverse attiva
   * (v. assertNotLoyverseManaged): qui il contenuto arriva solo da lì.
   * La categoria deve già esistere (per nome, case-insensitive): non ne
   * viene creata una nuova al volo, per evitare duplicati per un typo.
   */
  async importXlsx(
    venueId: string,
    buffer: Buffer,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    await this.assertNotLoyverseManaged(venueId);
    const rows = await this.xlsx.readSheet(buffer);
    const errors: string[] = [];

    const categories = await this.prisma.menuCategory.findMany({ where: { venueId } });
    const findCategory = (name: string) =>
      categories.find((c) => c.name.toLowerCase() === name.toLowerCase());

    interface GroupRow {
      rowNumber: number;
      raw: Record<string, unknown>;
    }
    const groups = new Map<string, GroupRow[]>();
    const groupOrder: string[] = [];
    rows.forEach((raw, index) => {
      const rowNumber = index + 2; // riga 1 = intestazioni
      const itemId = cellToString(raw[IMPORT_COLUMNS.itemId]);
      const key = itemId || `${cellToString(raw[IMPORT_COLUMNS.category])}::${cellToString(raw[IMPORT_COLUMNS.name])}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push({ rowNumber, raw });
    });

    let created = 0;
    let updated = 0;

    for (const key of groupOrder) {
      const groupRows = groups.get(key)!;
      const first = groupRows[0].raw;
      const rowNumbers = groupRows.map((r) => r.rowNumber).join(', ');
      try {
        const name = cellToString(first[IMPORT_COLUMNS.name]);
        const categoryName = cellToString(first[IMPORT_COLUMNS.category]);
        if (!name || !categoryName) {
          errors.push(`Riga ${rowNumbers}: categoria e nome sono obbligatori`);
          continue;
        }
        const category = findCategory(categoryName);
        if (!category) {
          errors.push(`Riga ${rowNumbers}: categoria "${categoryName}" non trovata`);
          continue;
        }

        const availabilityLabel = cellToString(first[IMPORT_COLUMNS.availability]).toLowerCase();
        const availability = availabilityLabel
          ? AVAILABILITY_BY_LABEL.get(availabilityLabel)
          : MenuAvailability.ALL_DAY;
        if (!availability) {
          errors.push(`Riga ${rowNumbers}: disponibilità "${cellToString(first[IMPORT_COLUMNS.availability])}" non valida`);
          continue;
        }

        const allergenLabels = cellToString(first[IMPORT_COLUMNS.allergens])
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const allergens: Allergen[] = [];
        let invalidAllergen: string | null = null;
        for (const label of allergenLabels) {
          const allergen = ALLERGEN_BY_LABEL.get(label.toLowerCase());
          if (!allergen) {
            invalidAllergen = label;
            break;
          }
          allergens.push(allergen);
        }
        if (invalidAllergen) {
          errors.push(`Riga ${rowNumbers}: allergene "${invalidAllergen}" non valido`);
          continue;
        }

        const variants = groupRows.map((r) => ({
          name: cellToString(r.raw[IMPORT_COLUMNS.variantName]),
          price: cellToNumber(r.raw[IMPORT_COLUMNS.price]) ?? null,
          active: cellToBoolean(r.raw[IMPORT_COLUMNS.variantActive], true),
        }));

        const sharedData = {
          name,
          categoryId: category.id,
          description: cellToString(first[IMPORT_COLUMNS.description]) || null,
          availability,
          allergens,
          featured: cellToBoolean(first[IMPORT_COLUMNS.featured], false),
          visible: cellToBoolean(first[IMPORT_COLUMNS.visible], true),
        };

        const itemId = cellToString(first[IMPORT_COLUMNS.itemId]) || undefined;
        let existing = itemId
          ? await this.prisma.menuItem.findUnique({ where: { id: itemId } })
          : null;
        if (existing && existing.venueId !== venueId) {
          errors.push(`Riga ${rowNumbers}: ID voce "${itemId}" appartiene a un altro locale`);
          continue;
        }
        if (!existing) {
          existing = await this.prisma.menuItem.findFirst({
            where: { venueId, categoryId: category.id, name: { equals: name, mode: 'insensitive' } },
          });
        }

        if (existing) {
          await this.prisma.$transaction(async (tx) => {
            await tx.menuItemVariant.deleteMany({ where: { menuItemId: existing!.id } });
            await tx.menuItem.update({
              where: { id: existing!.id },
              data: {
                ...sharedData,
                variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
              },
            });
          });
          updated++;
        } else {
          let sortOrder = 0;
          const last = await this.prisma.menuItem.findFirst({
            where: { venueId, categoryId: category.id },
            orderBy: { sortOrder: 'desc' },
          });
          sortOrder = (last?.sortOrder ?? -1) + 1;
          await this.prisma.menuItem.create({
            data: {
              ...(itemId ? { id: itemId } : {}),
              ...sharedData,
              venueId,
              sortOrder,
              variants: { create: variants.map((v, i) => ({ ...v, sortOrder: i })) },
            },
          });
          created++;
        }
      } catch (err) {
        errors.push(`Riga ${rowNumbers}: ${err instanceof Error ? err.message : 'errore sconosciuto'}`);
      }
    }

    return { created, updated, errors };
  }

  // ---- Menù pubblico (nessun login) --------------------------------------

  /**
   * Determina la fascia corrente (pranzo/cena/nessuna) in base alle fasce
   * pranzo/cena del MENÙ configurate dal locale per il giorno corrente
   * (`Venue.menuMealPeriodsHours`, indipendenti dall'orario reale di
   * apertura — §5.10 di DEVELOPMENT.md), calcolate nel fuso orario del
   * locale (`Venue.timezone`), non in quello del server. Un'eventuale
   * apertura speciale per la data di oggi (`VenueSpecialDay.menuHoursOverride`)
   * sostituisce per intero il giorno altrimenti risolto dallo schedule.
   */
  private async currentPeriod(
    venueId: string,
    menuMealPeriodsHoursRaw: unknown,
    timezone: string,
  ): Promise<'LUNCH' | 'DINNER' | 'NONE'> {
    const schedule = resolveOpeningHours(menuMealPeriodsHoursRaw);
    const now = new Date();
    const todayKey = specialDayKey(dateOnlyInZone(now, timezone));
    const special = await this.prisma.venueSpecialDay.findUnique({
      where: { venueId_date: { venueId, date: todayKey } },
    });
    const scheduledDay = schedule.find((d) => d.dayOfWeek === jsWeekdayInZone(now, timezone))!;
    const day = applyDayOverride(scheduledDay, special?.menuHoursOverride as DayOverride | null | undefined);
    const minutes = minutesOfDayInZone(now, timezone);
    const slot = findOpenSlot(day, minutes);
    return slot === 1 ? 'LUNCH' : slot === 2 ? 'DINNER' : 'NONE';
  }

  async getPublicMenu(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || !venue.active) {
      throw new NotFoundException('Locale non trovato');
    }

    const period = await this.currentPeriod(venueId, venue.menuMealPeriodsHours, venue.timezone);
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
        onlineOrdersEnabled: venue.onlineOrdersEnabled,
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

  // ---- Modificatori (§5.10 di DEVELOPMENT.md) ---------------------------

  async createModifierGroup(venueId: string, dto: CreateMenuModifierGroupDto) {
    await this.assertNotLoyverseManaged(venueId);
    const { options, ...group } = dto;
    return this.prisma.menuModifierGroup.create({
      data: { ...group, venueId, options: { create: options.map((o, i) => ({ ...o, sortOrder: i })) } },
      include: { options: true },
    });
  }

  listModifierGroups(venueId: string) {
    return this.prisma.menuModifierGroup.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  private async assertModifierGroupOwnership(venueId: string, groupId: string) {
    const group = await this.prisma.menuModifierGroup.findUnique({ where: { id: groupId } });
    if (!group || group.venueId !== venueId) throw new NotFoundException('Gruppo di modificatori non trovato');
  }

  /** Le opzioni si sostituiscono sempre tutte insieme, come le varianti di una voce di menù. */
  async updateModifierGroup(venueId: string, groupId: string, dto: UpdateMenuModifierGroupDto) {
    await this.assertNotLoyverseManaged(venueId);
    await this.assertModifierGroupOwnership(venueId, groupId);
    const { options, ...group } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (options) {
        await tx.menuModifierOption.deleteMany({ where: { groupId } });
      }
      return tx.menuModifierGroup.update({
        where: { id: groupId },
        data: {
          ...group,
          ...(options && { options: { create: options.map((o, i) => ({ ...o, sortOrder: i })) } }),
        },
        include: { options: true },
      });
    });
  }

  async removeModifierGroup(venueId: string, groupId: string) {
    await this.assertNotLoyverseManaged(venueId);
    await this.assertModifierGroupOwnership(venueId, groupId);
    await this.prisma.menuModifierGroup.delete({ where: { id: groupId } });
    return { success: true };
  }
}
