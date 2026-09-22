import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../common/crypto/secret-crypto';
import { safeExtension } from '../common/upload/safe-extension';
import { loyverseClient, LoyverseApiError, LoyverseItem, LoyverseVariant, variantDisplayName } from './loyverse-client';

export interface LoyverseSyncSummary {
  categories: number;
  items: number;
  itemsRemoved: number;
  categoriesRemoved: number;
  imagesDownloaded: number;
  imagesSkipped: boolean;
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
      const [remoteCategories, remoteItems] = await Promise.all([
        loyverseClient.listCategories(accessToken),
        loyverseClient.listItems(accessToken),
      ]);

      const { idMap: categoryIdMap, removed: categoriesRemoved } = await this.syncCategories(
        venueId,
        remoteCategories,
      );

      let imagesDownloaded = 0;
      let itemsSynced = 0;
      let sawAnyImageField = false;
      for (const item of remoteItems) {
        if (loyverseClient.extractImageUrl(item)) sawAnyImageField = true;
      }

      for (const item of remoteItems.filter((i) => !i.deleted_at)) {
        const result = await this.syncItem(venueId, item, categoryIdMap, warnings);
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

  /** Una voce Loyverse (con le sue varianti) → un MenuItem con le sue MenuItemVariant. */
  private async syncItem(
    venueId: string,
    remote: LoyverseItem,
    categoryIdMap: Map<string, string>,
    warnings: string[],
  ): Promise<{ synced: boolean; downloadedImage: boolean }> {
    const categoryId = remote.category_id ? categoryIdMap.get(remote.category_id) : undefined;
    if (!categoryId) {
      const message = `"${remote.item_name}" saltata: categoria non mappata (categoria Loyverse eliminata o non ancora sincronizzata).`;
      this.logger.warn(message);
      warnings.push(message);
      return { synced: false, downloadedImage: false };
    }

    const usableVariants = (remote.variants ?? []).filter(
      (v) => v.default_pricing_type !== 'VARIABLE' && v.default_price != null,
    );
    if (usableVariants.length === 0) {
      const message = `"${remote.item_name}" saltata: nessuna variante a prezzo fisso (il prezzo si decide in cassa in Loyverse, non c'è nulla da sincronizzare).`;
      this.logger.warn(message);
      warnings.push(message);
      return { synced: false, downloadedImage: false };
    }

    const existing = await this.prisma.menuItem.findFirst({
      where: { venueId, loyverseItemId: remote.id },
      include: { variants: true },
    });

    const description = remote.description ?? null;

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

    await this.syncVariants(menuItemId, usableVariants, existing?.variants ?? []);

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

  /** "usableVariants" è già filtrata alle sole varianti a prezzo fisso (v. syncItem). */
  private async syncVariants(
    menuItemId: string,
    usableVariants: LoyverseVariant[],
    existingVariants: { id: string; loyverseVariantId: string | null }[],
  ) {
    for (const [index, remote] of usableVariants.entries()) {
      const found = existingVariants.find((v) => v.loyverseVariantId === remote.variant_id);
      const data = {
        name: usableVariants.length > 1 ? variantDisplayName(remote) : '',
        price: remote.default_price as number,
        sortOrder: index,
      };
      if (found) {
        await this.prisma.menuItemVariant.update({ where: { id: found.id }, data });
      } else {
        await this.prisma.menuItemVariant.create({
          data: { ...data, menuItemId, loyverseVariantId: remote.variant_id },
        });
      }
    }

    // Varianti rimosse in Loyverse (o diventate "VARIABLE" senza prezzo
    // fisso): disattivate, non eliminate (nessuna dipendenza le referenzia
    // oggi, ma teniamo lo storico coerente con lo stesso criterio usato
    // altrove nell'app).
    const remoteIds = new Set(usableVariants.map((v) => v.variant_id));
    for (const variant of existingVariants) {
      if (variant.loyverseVariantId && !remoteIds.has(variant.loyverseVariantId)) {
        await this.prisma.menuItemVariant.update({ where: { id: variant.id }, data: { active: false } });
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
