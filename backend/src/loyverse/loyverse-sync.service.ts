import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../common/crypto/secret-crypto';
import { safeExtension } from '../common/upload/safe-extension';
import { loyverseClient, LoyverseApiError, LoyverseItem } from './loyverse-client';

export interface LoyverseSyncSummary {
  categories: number;
  items: number;
  imagesDownloaded: number;
  imagesSkipped: boolean;
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

    try {
      const accessToken = decryptSecret(venue.loyverseAccessTokenEnc);
      const [remoteCategories, remoteItems] = await Promise.all([
        loyverseClient.listCategories(accessToken),
        loyverseClient.listItems(accessToken),
      ]);

      const categoryIdMap = await this.syncCategories(venueId, remoteCategories);

      let imagesDownloaded = 0;
      let sawAnyImageField = false;
      for (const item of remoteItems) {
        if (loyverseClient.extractImageUrl(item)) sawAnyImageField = true;
      }

      for (const item of remoteItems.filter((i) => !i.deleted_at)) {
        const downloaded = await this.syncItem(venueId, item, categoryIdMap);
        if (downloaded) imagesDownloaded++;
      }

      await this.prisma.venue.update({
        where: { id: venueId },
        data: { loyverseLastSyncAt: new Date(), loyverseLastSyncError: null },
      });

      return {
        categories: remoteCategories.length,
        items: remoteItems.length,
        imagesDownloaded,
        imagesSkipped: !sawAnyImageField,
      };
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
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const existing = await this.prisma.menuCategory.findMany({ where: { venueId } });
    let nextSortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

    for (const remote of remoteCategories.filter((c) => !c.deleted_at)) {
      const found = existing.find((c) => c.loyverseCategoryId === remote.id);
      if (found) {
        if (found.name !== remote.name) {
          await this.prisma.menuCategory.update({ where: { id: found.id }, data: { name: remote.name } });
        }
        map.set(remote.id, found.id);
      } else {
        const created = await this.prisma.menuCategory.create({
          data: {
            venueId,
            name: remote.name,
            loyverseCategoryId: remote.id,
            sortOrder: nextSortOrder++,
          },
        });
        map.set(remote.id, created.id);
      }
    }

    // Categorie rimosse in Loyverse: eliminate solo se rimaste vuote, per
    // non perdere voci di menù ancora presenti per qualche disallineamento.
    const remoteIds = new Set(remoteCategories.filter((c) => !c.deleted_at).map((c) => c.id));
    for (const category of existing) {
      if (!category.loyverseCategoryId || remoteIds.has(category.loyverseCategoryId)) continue;
      const itemCount = await this.prisma.menuItem.count({ where: { categoryId: category.id } });
      if (itemCount === 0) {
        await this.prisma.menuCategory.delete({ where: { id: category.id } });
      }
    }

    return map;
  }

  /** Una voce Loyverse (con le sue varianti) → un MenuItem con le sue MenuItemVariant. */
  private async syncItem(
    venueId: string,
    remote: LoyverseItem,
    categoryIdMap: Map<string, string>,
  ): Promise<boolean> {
    const categoryId = remote.category_id ? categoryIdMap.get(remote.category_id) : undefined;
    if (!categoryId) {
      this.logger.warn(`Voce Loyverse "${remote.item_name}" senza categoria mappata: saltata.`);
      return false;
    }

    const existing = await this.prisma.menuItem.findFirst({
      where: { venueId, loyverseItemId: remote.id },
      include: { variants: true },
    });

    let menuItemId: string;
    if (existing) {
      if (existing.name !== remote.item_name || existing.categoryId !== categoryId) {
        await this.prisma.menuItem.update({
          where: { id: existing.id },
          data: { name: remote.item_name, categoryId },
        });
      }
      menuItemId = existing.id;
    } else {
      const created = await this.prisma.menuItem.create({
        data: {
          venueId,
          categoryId,
          name: remote.item_name,
          loyverseItemId: remote.id,
          visible: false, // nascosta finché l'admin non la rivede e la pubblica
        },
      });
      menuItemId = created.id;
    }

    await this.syncVariants(menuItemId, remote.variants ?? [], existing?.variants ?? []);

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

    return downloadedImage;
  }

  private async syncVariants(
    menuItemId: string,
    remoteVariants: { variant_id: string; default_price?: number; variant_name?: string }[],
    existingVariants: { id: string; loyverseVariantId: string | null }[],
  ) {
    const usable = remoteVariants.filter((v) => v.default_price != null);
    for (const [index, remote] of usable.entries()) {
      const found = existingVariants.find((v) => v.loyverseVariantId === remote.variant_id);
      const data = {
        name: usable.length > 1 ? remote.variant_name ?? '' : '',
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

    // Varianti rimosse in Loyverse: disattivate, non eliminate (nessuna
    // dipendenza le referenzia oggi, ma teniamo lo storico coerente con lo
    // stesso criterio usato altrove nell'app).
    const remoteIds = new Set(usable.map((v) => v.variant_id));
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
