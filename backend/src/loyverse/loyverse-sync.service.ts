import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import sanitizeHtml from 'sanitize-html';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../common/crypto/secret-crypto';
import { safeExtension } from '../common/upload/safe-extension';
import {
  loyverseClient,
  LoyverseApiError,
  LoyverseItem,
  LoyverseModifier,
  LoyverseModifierOption,
  LoyverseVariant,
  variantDisplayName,
} from './loyverse-client';

/**
 * Le descrizioni Loyverse arrivano come richtext HTML (es. "<p>...</p>").
 * Nel menù online vogliamo solo testo semplice, senza formattazioni: qui
 * i tag di blocco diventano a capo, il resto viene rimosso.
 */
export function richTextToPlainText(html: string | null | undefined): string | null {
  if (!html) return null;
  const withBreaks = html.replace(/<\s*\/(p|div|li|h[1-6])\s*>|<\s*br\s*\/?>/gi, '\n');
  const plain = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  const trimmed = plain
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return trimmed || null;
}

export interface LoyverseSyncSummary {
  categories: number;
  items: number;
  itemsRemoved: number;
  categoriesRemoved: number;
  imagesDownloaded: number;
  imagesSkipped: boolean;
  modifierGroups: number;
  /** Voci Loyverse saltate durante il sync e il motivo (es. senza categoria mappata). */
  warnings: string[];
}

/**
 * Sincronizza categorie/voci/prezzi/immagini da Loyverse nel menù di
 * BarManager. Motore "di fiducia": a differenza delle richieste admin
 * (menu.service.ts), qui creiamo/modifichiamo categorie e voci di menù
 * anche quando l'integrazione è attiva — è esattamente lo scopo di questo
 * servizio. Non tocca mai descrizione/allergeni (Loyverse non li ha) né la
 * visibilità/disponibilità già decisa in BarManager.
 */
@Injectable()
export class LoyverseSyncService {
  private readonly logger = new Logger(LoyverseSyncService.name);

  constructor(private prisma: PrismaService) {}

  async sync(venueId: string): Promise<LoyverseSyncSummary> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');
    if (!venue.loyverseIntegrationEnabled || !venue.loyverseAccessTokenEnc) {
      throw new NotFoundException('Integrazione Loyverse non configurata per questo locale');
    }

    const warnings: string[] = [];

    try {
      const accessToken = decryptSecret(venue.loyverseAccessTokenEnc);
      const [remoteCategories, remoteItems, remoteModifiers] = await Promise.all([
        loyverseClient.listCategories(accessToken),
        loyverseClient.listItems(accessToken),
        loyverseClient.listModifiers(accessToken),
      ]);

      const { idMap: categoryIdMap, removed: categoriesRemoved } = await this.syncCategories(
        venueId,
        remoteCategories,
      );

      const modifierGroupIdMap = await this.syncModifierGroups(venueId, remoteModifiers);
      const modifierItemMap = this.buildModifierItemMap(remoteModifiers);

      let imagesDownloaded = 0;
      let itemsSynced = 0;
      let sawAnyImageField = false;
      for (const item of remoteItems) {
        if (loyverseClient.extractImageUrl(item)) sawAnyImageField = true;
      }

      // Creata al bisogno, una sola volta per sync, solo se davvero serve.
      const fallbackCategory: { id?: string } = {};

      for (const item of remoteItems.filter((i) => !i.deleted_at)) {
        const result = await this.syncItem(
          venueId,
          item,
          categoryIdMap,
          fallbackCategory,
          warnings,
          modifierGroupIdMap,
          modifierItemMap,
        );
        if (result.synced) itemsSynced++;
        if (result.downloadedImage) imagesDownloaded++;
      }

      const itemsRemoved = await this.removeStaleItems(venueId, remoteItems);

      const summary: LoyverseSyncSummary = {
        categories: categoryIdMap.size,
        items: itemsSynced,
        itemsRemoved,
        categoriesRemoved,
        imagesDownloaded,
        imagesSkipped: !sawAnyImageField,
        modifierGroups: modifierGroupIdMap.size,
        warnings,
      };

      await this.prisma.venue.update({
        where: { id: venueId },
        data: {
          loyverseLastSyncAt: new Date(),
          loyverseLastSyncError: null,
          loyverseLastSyncSummary: summary as unknown as Prisma.InputJsonValue,
        },
      });

      return summary;
    } catch (err) {
      const message =
        err instanceof LoyverseApiError ? err.message : 'Errore imprevisto durante la sincronizzazione.';
      await this.prisma.venue.update({
        where: { id: venueId },
        data: { loyverseLastSyncError: message },
      });
      this.logger.error(`Sync Loyverse fallita per venue=${venueId}: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Categorie Loyverse → MenuCategory, aggiunte in coda senza toccare l'ordine esistente. */
  private async syncCategories(
    venueId: string,
    remoteCategories: { id: string; name: string; deleted_at?: string | null }[],
  ): Promise<{ idMap: Map<string, string>; removed: number }> {
    const idMap = new Map<string, string>();
    const existing = await this.prisma.menuCategory.findMany({ where: { venueId } });
    let nextSortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

    for (const remote of remoteCategories.filter((c) => !c.deleted_at)) {
      const found = existing.find((c) => c.loyverseCategoryId === remote.id);
      if (found) {
        if (found.name !== remote.name) {
          await this.prisma.menuCategory.update({ where: { id: found.id }, data: { name: remote.name } });
        }
        idMap.set(remote.id, found.id);
      } else {
        const created = await this.prisma.menuCategory.create({
          data: {
            venueId,
            name: remote.name,
            loyverseCategoryId: remote.id,
            sortOrder: nextSortOrder++,
            visible: false, // nascosta finché l'admin non la rivede e la pubblica, come le voci
          },
        });
        idMap.set(remote.id, created.id);
      }
    }

    // Categorie rimosse in Loyverse: eliminate solo se rimaste vuote, per
    // non perdere voci di menù ancora presenti per qualche disallineamento
    // (si puliranno da sole al sync successivo, una volta svuotate anche
    // le loro voci da removeStaleItems).
    let removed = 0;
    const remoteIds = new Set(remoteCategories.filter((c) => !c.deleted_at).map((c) => c.id));
    for (const category of existing) {
      if (!category.loyverseCategoryId || remoteIds.has(category.loyverseCategoryId)) continue;
      const itemCount = await this.prisma.menuItem.count({ where: { categoryId: category.id } });
      if (itemCount === 0) {
        await this.prisma.menuCategory.delete({ where: { id: category.id } });
        removed++;
      }
    }

    return { idMap, removed };
  }

  /**
   * Modificatori Loyverse (Modifier + le sue Modifier_option) →
   * MenuModifierGroup/MenuModifierOption, stesso pattern "mirror" delle
   * categorie: nome/opzioni sempre sovrascritti dal sync. Loyverse non
   * espone impostazioni di selezione (obbligatorio/multiplo/min-max) sul
   * modificatore — i gruppi sincronizzati restano sempre "selezione
   * multipla, opzionale" (il comportamento più permissivo, nessun vincolo
   * inventato che Loyverse non ha mai definito). Solo i gruppi con
   * loyverseModifierId sono toccati: quelli nativi (creati a mano prima di
   * attivare Loyverse, o quando l'integrazione è spenta) restano intatti.
   */
  private async syncModifierGroups(
    venueId: string,
    remoteModifiers: LoyverseModifier[],
  ): Promise<Map<string, string>> {
    const idMap = new Map<string, string>();
    const existingGroups = await this.prisma.menuModifierGroup.findMany({
      where: { venueId, loyverseModifierId: { not: null } },
      include: { options: true },
    });

    for (const remote of remoteModifiers.filter((m) => !m.deleted_at)) {
      const found = existingGroups.find((g) => g.loyverseModifierId === remote.id);
      let groupId: string;
      if (found) {
        groupId = found.id;
        if (found.name !== remote.name) {
          await this.prisma.menuModifierGroup.update({ where: { id: groupId }, data: { name: remote.name } });
        }
      } else {
        const created = await this.prisma.menuModifierGroup.create({
          data: {
            venueId,
            name: remote.name,
            loyverseModifierId: remote.id,
            selectionType: 'MULTIPLE',
            minSelections: 0,
          },
        });
        groupId = created.id;
      }

      const remoteOptions = remote.modifier_options ?? remote.options ?? [];
      await this.syncModifierOptions(groupId, remoteOptions, found?.options ?? []);
      idMap.set(remote.id, groupId);
    }

    // Gruppi rimossi in Loyverse: eliminati (cascata su opzioni e
    // assegnazioni alle voci), mai quelli nativi (esclusi dal find sopra).
    const remoteIds = new Set(remoteModifiers.filter((m) => !m.deleted_at).map((m) => m.id));
    for (const group of existingGroups) {
      if (group.loyverseModifierId && !remoteIds.has(group.loyverseModifierId)) {
        await this.prisma.menuModifierGroup.delete({ where: { id: group.id } });
      }
    }

    return idMap;
  }

  private async syncModifierOptions(
    groupId: string,
    remoteOptions: LoyverseModifierOption[],
    existingOptions: { id: string; loyverseModifierOptionId: string | null }[],
  ) {
    for (const [index, remote] of remoteOptions.entries()) {
      const found = existingOptions.find((o) => o.loyverseModifierOptionId === remote.id);
      const name = remote.name || remote.option_name || '';
      const rawPrice =
        remote.price ?? remote.price_delta ?? remote.default_price ?? 0;
      const price = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice) || 0;
      const data = { name, price, sortOrder: index };
      if (found) {
        await this.prisma.menuModifierOption.update({ where: { id: found.id }, data });
      } else {
        await this.prisma.menuModifierOption.create({
          data: { ...data, groupId, loyverseModifierOptionId: remote.id },
        });
      }
    }

    const remoteIds = new Set(remoteOptions.map((o) => o.id));
    for (const option of existingOptions) {
      if (option.loyverseModifierOptionId && !remoteIds.has(option.loyverseModifierOptionId)) {
        await this.prisma.menuModifierOption.delete({ where: { id: option.id } });
      }
    }
  }

  /**
   * Categoria di riserva per le voci Loyverse la cui categoria non esiste
   * più (eliminata su Loyverse, ma l'articolo è rimasto agganciato al
   * vecchio id): mai saltarle, altrimenti sparirebbero senza che l'admin
   * se ne accorga. Creata una sola volta per locale — mentre l'integrazione
   * è attiva è l'unica categoria senza "loyverseCategoryId", perché tutte
   * le altre arrivano da Loyverse e attivare l'integrazione svuota sempre
   * il menù precedente (v. LoyverseService.updateSettings).
   */
  private async getOrCreateFallbackCategory(venueId: string): Promise<string> {
    const existing = await this.prisma.menuCategory.findFirst({
      where: { venueId, loyverseCategoryId: null, name: 'Altri prodotti' },
    });
    if (existing) return existing.id;

    const last = await this.prisma.menuCategory.findFirst({
      where: { venueId },
      orderBy: { sortOrder: 'desc' },
    });
    const created = await this.prisma.menuCategory.create({
      data: {
        venueId,
        name: 'Altri prodotti',
        loyverseCategoryId: null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        visible: false,
      },
    });
    return created.id;
  }

  /**
   * Voci sincronizzate in precedenza il cui prodotto Loyverse non esiste
   * più (rimosso o marcato deleted_at): eliminate anche in BarManager,
   * varianti a cascata. Non tocca in alcun modo la visibilità delle voci
   * ancora presenti — questo è il solo modo in cui un sync successivo
   * rimuove contenuto, mai per un cambio di preferenza dell'admin.
   */
  private async removeStaleItems(venueId: string, remoteItems: { id: string; deleted_at?: string | null }[]) {
    const activeRemoteIds = new Set(remoteItems.filter((i) => !i.deleted_at).map((i) => i.id));
    const existing = await this.prisma.menuItem.findMany({
      where: { venueId, loyverseItemId: { not: null } },
      select: { id: true, loyverseItemId: true },
    });

    let removed = 0;
    for (const item of existing) {
      if (item.loyverseItemId && !activeRemoteIds.has(item.loyverseItemId)) {
        await this.prisma.menuItem.delete({ where: { id: item.id } });
        removed++;
      }
    }
    return removed;
  }

  private buildModifierItemMap(remoteModifiers: LoyverseModifier[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const mod of remoteModifiers) {
      if (mod.deleted_at) continue;
      const directItemIds = mod.item_ids ?? [];
      const nestedItemIds = Array.isArray(mod.items)
        ? mod.items
            .map((it) => (typeof it === 'string' ? it : it?.id || it?.item_id))
            .filter((id): id is string => !!id && typeof id === 'string')
        : [];
      const allItemIds = new Set([...directItemIds, ...nestedItemIds]);
      for (const itemId of allItemIds) {
        if (!map.has(itemId)) {
          map.set(itemId, new Set());
        }
        map.get(itemId)!.add(mod.id);
      }
    }
    return map;
  }

  private extractRemoteModifierIds(
    remote: LoyverseItem,
    modifierItemMap?: Map<string, Set<string>>,
  ): string[] {
    const ids = new Set<string>();

    // 1. modifier_ids (API ufficiale Loyverse GET /v1.0/items)
    if (Array.isArray(remote.modifier_ids)) {
      for (const id of remote.modifier_ids) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }

    // 2. modifiers_ids (variante ortografica con s)
    if (Array.isArray(remote.modifiers_ids)) {
      for (const id of remote.modifiers_ids) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }

    // 3. modifiers (array di ID o oggetti { id } / { modifier_id })
    if (Array.isArray(remote.modifiers)) {
      for (const m of remote.modifiers) {
        if (typeof m === 'string' && m.trim()) {
          ids.add(m.trim());
        } else if (m && typeof m === 'object') {
          const modId =
            (m as { id?: string; modifier_id?: string }).id ||
            (m as { id?: string; modifier_id?: string }).modifier_id;
          if (typeof modId === 'string' && modId.trim()) ids.add(modId.trim());
        }
      }
    }

    // 4. Modificatori assegnati a livello di varianti
    if (Array.isArray(remote.variants)) {
      for (const v of remote.variants) {
        const vModIds = (v as any).modifier_ids || (v as any).modifiers_ids;
        if (Array.isArray(vModIds)) {
          for (const id of vModIds) {
            if (typeof id === 'string' && id.trim()) ids.add(id.trim());
          }
        }
      }
    }

    // 5. Associazioni inverse dal lato modificatore
    if (modifierItemMap && modifierItemMap.has(remote.id)) {
      for (const id of modifierItemMap.get(remote.id)!) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  /** Una voce Loyverse (con le sue varianti) → un MenuItem con le sue MenuItemVariant. */
  private async syncItem(
    venueId: string,
    remote: LoyverseItem,
    categoryIdMap: Map<string, string>,
    fallbackCategory: { id?: string },
    warnings: string[],
    modifierGroupIdMap: Map<string, string>,
    modifierItemMap?: Map<string, Set<string>>,
  ): Promise<{ synced: boolean; downloadedImage: boolean }> {
    let categoryId = remote.category_id ? categoryIdMap.get(remote.category_id) : undefined;
    if (!categoryId) {
      if (!fallbackCategory.id) {
        fallbackCategory.id = await this.getOrCreateFallbackCategory(venueId);
      }
      categoryId = fallbackCategory.id;
      const message = `"${remote.item_name}" inserita in "Altri prodotti": categoria Loyverse non trovata (eliminata, o mai assegnata). Assegna una categoria valida in Loyverse per spostarla al prossimo sync.`;
      this.logger.warn(message);
      warnings.push(message);
    }

    // Nessuna variante scartata: quelle a prezzo variabile (deciso in cassa
    // o a peso) restano nel menù senza importo, non spariscono.
    const remoteVariants = remote.variants && remote.variants.length > 0 ? remote.variants : [{ variant_id: '' }];

    const existing = await this.prisma.menuItem.findFirst({
      where: { venueId, loyverseItemId: remote.id },
      include: { variants: true },
    });

    const description = richTextToPlainText(remote.description);

    let menuItemId: string;
    if (existing) {
      if (
        existing.name !== remote.item_name ||
        existing.categoryId !== categoryId ||
        existing.description !== description
      ) {
        await this.prisma.menuItem.update({
          where: { id: existing.id },
          data: { name: remote.item_name, categoryId, description },
        });
      }
      menuItemId = existing.id;
    } else {
      const created = await this.prisma.menuItem.create({
        data: {
          venueId,
          categoryId,
          name: remote.item_name,
          description,
          loyverseItemId: remote.id,
          visible: false, // nascosta finché l'admin non la rivede e la pubblica
        },
      });
      menuItemId = created.id;
    }

    await this.syncVariants(menuItemId, remoteVariants, existing?.variants ?? []);
    const remoteModifierIds = this.extractRemoteModifierIds(remote, modifierItemMap);
    await this.syncItemModifierGroups(menuItemId, remoteModifierIds, modifierGroupIdMap);

    let downloadedImage = false;
    if (!existing?.photoUrl) {
      const imageUrl = loyverseClient.extractImageUrl(remote);
      if (imageUrl) {
        const savedUrl = await this.downloadImage(imageUrl);
        if (savedUrl) {
          await this.prisma.menuItem.update({ where: { id: menuItemId }, data: { photoUrl: savedUrl } });
          downloadedImage = true;
        }
      }
    }

    return { synced: true, downloadedImage };
  }

  /**
   * Tutte le varianti dell'item vengono sincronizzate, nessuna scartata:
   * quelle a prezzo variabile (default_pricing_type "VARIABLE", o senza
   * default_price) prendono price: null, mostrata come "prezzo variabile"
   * invece che con un importo.
   */
  private async syncVariants(
    menuItemId: string,
    remoteVariants: LoyverseVariant[],
    existingVariants: { id: string; loyverseVariantId: string | null }[],
  ) {
    for (const [index, remote] of remoteVariants.entries()) {
      const found = existingVariants.find((v) => v.loyverseVariantId === remote.variant_id);
      const price =
        remote.default_pricing_type !== 'VARIABLE' && remote.default_price != null
          ? remote.default_price
          : null;
      const data = {
        name: remoteVariants.length > 1 ? variantDisplayName(remote) : '',
        price,
        sortOrder: index,
        active: true,
      };
      if (found) {
        await this.prisma.menuItemVariant.update({ where: { id: found.id }, data });
      } else {
        await this.prisma.menuItemVariant.create({
          data: { ...data, menuItemId, loyverseVariantId: remote.variant_id },
        });
      }
    }

    // Varianti rimosse in Loyverse: disattivate, non eliminate (nessuna
    // dipendenza le referenzia oggi, ma teniamo lo storico coerente con lo
    // stesso criterio usato altrove nell'app).
    const remoteIds = new Set(remoteVariants.map((v) => v.variant_id));
    for (const variant of existingVariants) {
      if (variant.loyverseVariantId && !remoteIds.has(variant.loyverseVariantId)) {
        await this.prisma.menuItemVariant.update({ where: { id: variant.id }, data: { active: false } });
      }
    }
  }

  /**
   * Item.modifier_ids (Loyverse) → MenuItemModifierGroup per questa voce.
   * Tocca solo i link verso gruppi con origine Loyverse (risolti tramite
   * modifierGroupIdMap, popolata solo da syncModifierGroups): un gruppo
   * nativo assegnato a mano dall'admin non viene mai toccato dal sync,
   * anche se questa stessa voce è sincronizzata da Loyverse.
   */
  private async syncItemModifierGroups(
    menuItemId: string,
    remoteModifierIds: string[],
    modifierGroupIdMap: Map<string, string>,
  ) {
    const wantedGroupIds = new Set(
      remoteModifierIds.map((id) => modifierGroupIdMap.get(id)).filter((id): id is string => !!id),
    );

    const existingLinks = await this.prisma.menuItemModifierGroup.findMany({
      where: { menuItemId },
      include: { modifierGroup: { select: { loyverseModifierId: true } } },
    });

    for (const groupId of wantedGroupIds) {
      if (!existingLinks.some((l) => l.modifierGroupId === groupId)) {
        await this.prisma.menuItemModifierGroup.create({ data: { menuItemId, modifierGroupId: groupId } });
      }
    }

    for (const link of existingLinks) {
      if (link.modifierGroup.loyverseModifierId && !wantedGroupIds.has(link.modifierGroupId)) {
        await this.prisma.menuItemModifierGroup.delete({
          where: { menuItemId_modifierGroupId: { menuItemId, modifierGroupId: link.modifierGroupId } },
        });
      }
    }
  }

  /** Scarica l'immagine e la salva con estensione dedotta dal Content-Type reale, mai dall'URL. */
  private async downloadImage(imageUrl: string): Promise<string | null> {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
      const extension = safeExtension(contentType);
      if (!extension) return null; // tipo non nella lista consentita: scartata

      const buffer = Buffer.from(await res.arrayBuffer());
      const uploadsDir = process.env.UPLOADS_DIR || './uploads';
      const filename = `${randomUUID()}${extension}`;
      await writeFile(`${uploadsDir}/menu/${filename}`, buffer);
      return `/uploads/menu/${filename}`;
    } catch (err) {
      this.logger.warn(`Download immagine Loyverse fallito: ${(err as Error).message}`);
      return null;
    }
  }
}
