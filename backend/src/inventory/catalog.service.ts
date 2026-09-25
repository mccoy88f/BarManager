import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { XlsxService } from '../reports/xlsx.service';
import { isoWeekdayInZone } from '../common/timezone/timezone';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

export type ProductTrend = 'UP' | 'DOWN' | 'STABLE' | null;

const IMPORT_COLUMNS = {
  productId: 'ID prodotto',
  name: 'Nome',
  category: 'Categoria',
  supplier: 'Fornitore',
  unit: 'Unità',
  standardQty: 'Quantità standard',
  reorderAt: 'Soglia minima',
  supplierCode: 'Codice fornitore',
  costPerUnit: 'Costo unitario',
  unitsPerPackage: 'Unità per confezione',
  active: 'Attivo',
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

// Quanti ordini inviati recenti al fornitore servono per valutare il
// trend: con meno dati storici di questi non si azzarda una valutazione.
const RECENT_ORDERS_FOR_TREND = 4;

/**
 * UP: la giacenza media rilevata negli ultimi ordini è sempre sotto la
 * metà dello standard -> si vende più del previsto (rischio rottura di
 * stock se si ordina poco). DOWN: sempre sopra la metà -> si vende meno
 * del previsto (rischio magazzino pieno). STABLE: la media coincide
 * esattamente con la metà dello standard.
 */
function computeTrend(
  standardQty: number,
  recentOrders: { lines: { productId: string; stockOnHand: number }[] }[],
  productId: string,
): ProductTrend {
  if (recentOrders.length < RECENT_ORDERS_FOR_TREND) return null;

  const stockValues = recentOrders.map(
    (order) => order.lines.find((line) => line.productId === productId)?.stockOnHand,
  );
  if (stockValues.some((v) => v == null)) return null;

  const average =
    (stockValues as number[]).reduce((sum, v) => sum + v, 0) / stockValues.length;
  const half = standardQty / 2;
  if (average < half) return 'UP';
  if (average > half) return 'DOWN';
  return 'STABLE';
}

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private xlsx: XlsxService,
  ) {}

  // Categorie
  createCategory(venueId: string, dto: CreateCategoryDto) {
    return this.prisma.productCategory.create({ data: { ...dto, venueId } });
  }

  listCategories(venueId: string) {
    return this.prisma.productCategory.findMany({
      where: { venueId, active: true },
      include: { products: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateCategory(venueId: string, categoryId: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    return this.prisma.productCategory.update({ where: { id: categoryId }, data: dto });
  }

  /** Disattiva la categoria senza perdere lo storico dei prodotti/ordini collegati. */
  async removeCategory(venueId: string, categoryId: string) {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    await this.prisma.productCategory.update({ where: { id: categoryId }, data: { active: false } });
    return { success: true };
  }

  // Fornitori
  createSupplier(venueId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: { ...dto, ccEmails: dto.ccEmails ?? [], venueId },
    });
  }

  listSuppliers(venueId: string) {
    return this.prisma.supplier.findMany({
      where: { venueId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateSupplier(venueId: string, supplierId: string, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }
    return this.prisma.supplier.update({ where: { id: supplierId }, data: dto });
  }

  /** Disattiva il fornitore senza perdere lo storico di prodotti/ordini collegati. */
  async removeSupplier(venueId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }
    await this.prisma.supplier.update({ where: { id: supplierId }, data: { active: false } });
    return { success: true };
  }

  /** Fornitori il cui giorno di ordine ricorrente è oggi (usato in home), nel fuso orario del locale. */
  async listSuppliersDueToday(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } });
    const isoWeekday = isoWeekdayInZone(new Date(), venue?.timezone);
    return this.prisma.supplier.findMany({
      where: { venueId, active: true, orderDays: { has: isoWeekday } },
      orderBy: { name: 'asc' },
    });
  }

  // Prodotti
  async createProduct(venueId: string, dto: CreateProductDto) {
    await this.assertCategoryAndSupplierOwnership(venueId, dto.categoryId, dto.supplierId);
    return this.prisma.product.create({ data: dto });
  }

  async updateProduct(venueId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product || product.category.venueId !== venueId) {
      throw new NotFoundException('Prodotto non trovato');
    }
    if (dto.categoryId || dto.supplierId) {
      await this.assertCategoryAndSupplierOwnership(
        venueId,
        dto.categoryId ?? product.categoryId,
        dto.supplierId ?? product.supplierId,
      );
    }
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  private async assertCategoryAndSupplierOwnership(
    venueId: string,
    categoryId: string,
    supplierId: string,
  ) {
    const [category, supplier] = await Promise.all([
      this.prisma.productCategory.findUnique({ where: { id: categoryId } }),
      this.prisma.supplier.findUnique({ where: { id: supplierId } }),
    ]);
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }
  }

  listProducts(
    venueId: string,
    filters: { categoryId?: string; supplierId?: string; includeInactive?: boolean },
  ) {
    return this.prisma.product.findMany({
      where: {
        active: filters.includeInactive ? undefined : true,
        category: { venueId, active: filters.includeInactive ? undefined : true },
        categoryId: filters.categoryId,
        supplierId: filters.supplierId,
      },
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Trend di vendita per prodotto, dedotto dagli ultimi ordini inviati
   * allo stesso fornitore (v. computeTrend). Un giro di query per
   * fornitore coinvolto, non per prodotto.
   */
  async getProductTrends(
    venueId: string,
    productIds: string[],
  ): Promise<Record<string, ProductTrend>> {
    if (productIds.length === 0) return {};

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, category: { venueId } },
      select: { id: true, standardQty: true, supplierId: true },
    });

    const bySupplier = new Map<string, typeof products>();
    for (const product of products) {
      const list = bySupplier.get(product.supplierId) ?? [];
      list.push(product);
      bySupplier.set(product.supplierId, list);
    }

    const result: Record<string, ProductTrend> = {};
    for (const [supplierId, supplierProducts] of bySupplier) {
      const recentOrders = await this.prisma.order.findMany({
        where: {
          venueId,
          supplierId,
          status: { in: [OrderStatus.SENT, OrderStatus.CONFIRMED, OrderStatus.CLOSED] },
        },
        orderBy: { sentAt: 'desc' },
        take: RECENT_ORDERS_FOR_TREND,
        include: {
          lines: {
            where: { productId: { in: supplierProducts.map((p) => p.id) } },
            select: { productId: true, stockOnHand: true },
          },
        },
      });

      for (const product of supplierProducts) {
        result[product.id] = computeTrend(product.standardQty, recentOrders, product.id);
      }
    }

    return result;
  }

  /** Esporta il catalogo prodotti in xlsx, stesso formato accettato da importXlsx (v. sotto). Include anche i prodotti disattivati, per non perderli a un giro export/reimport. */
  async exportXlsx(venueId: string): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      where: { category: { venueId } },
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
    });
    const rows = products.map((p) => ({
      productId: p.id,
      name: p.name,
      category: p.category.name,
      supplier: p.supplier.name,
      unit: p.unit,
      standardQty: p.standardQty,
      reorderAt: p.reorderAt ?? '',
      supplierCode: p.supplierCode ?? '',
      costPerUnit: p.costPerUnit ?? '',
      unitsPerPackage: p.unitsPerPackage ?? '',
      active: p.active ? 'SI' : 'NO',
    }));
    return this.xlsx.buildSheet(
      'Prodotti',
      [
        { header: IMPORT_COLUMNS.productId, key: 'productId', width: 28 },
        { header: IMPORT_COLUMNS.name, key: 'name', width: 24 },
        { header: IMPORT_COLUMNS.category, key: 'category', width: 20 },
        { header: IMPORT_COLUMNS.supplier, key: 'supplier', width: 20 },
        { header: IMPORT_COLUMNS.unit, key: 'unit', width: 14 },
        { header: IMPORT_COLUMNS.standardQty, key: 'standardQty', width: 16 },
        { header: IMPORT_COLUMNS.reorderAt, key: 'reorderAt', width: 14 },
        { header: IMPORT_COLUMNS.supplierCode, key: 'supplierCode', width: 18 },
        { header: IMPORT_COLUMNS.costPerUnit, key: 'costPerUnit', width: 14 },
        { header: IMPORT_COLUMNS.unitsPerPackage, key: 'unitsPerPackage', width: 18 },
        { header: IMPORT_COLUMNS.active, key: 'active', width: 10 },
      ],
      rows,
    );
  }

  /**
   * Importa prodotti da xlsx (stesso formato di exportXlsx, colonne
   * identificate per intestazione). Categoria e fornitore sono risolti per
   * nome (case-insensitive) fra quelli già esistenti nel locale: non
   * vengono creati al volo, per evitare duplicati per un typo. Se "ID
   * prodotto" è presente e trovato viene aggiornato; altrimenti si cerca
   * per nome fra i prodotti del locale; se non trovato viene creato. Una
   * riga non valida non blocca le altre: l'errore viene raccolto e
   * riportato a fine importazione.
   */
  async importXlsx(
    venueId: string,
    buffer: Buffer,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const rows = await this.xlsx.readSheet(buffer);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    const [categories, suppliers] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { venueId } }),
      this.prisma.supplier.findMany({ where: { venueId } }),
    ]);
    const findCategory = (name: string) =>
      categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const findSupplier = (name: string) =>
      suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase());

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2; // riga 1 = intestazioni
      try {
        const name = cellToString(row[IMPORT_COLUMNS.name]);
        const unit = cellToString(row[IMPORT_COLUMNS.unit]);
        const standardQty = cellToNumber(row[IMPORT_COLUMNS.standardQty]);
        const categoryName = cellToString(row[IMPORT_COLUMNS.category]);
        const supplierName = cellToString(row[IMPORT_COLUMNS.supplier]);
        if (!name || !unit || standardQty == null || !categoryName || !supplierName) {
          errors.push(
            `Riga ${rowNumber}: nome, unità, quantità standard, categoria e fornitore sono obbligatori`,
          );
          continue;
        }

        const category = findCategory(categoryName);
        if (!category) {
          errors.push(`Riga ${rowNumber}: categoria "${categoryName}" non trovata`);
          continue;
        }
        const supplier = findSupplier(supplierName);
        if (!supplier) {
          errors.push(`Riga ${rowNumber}: fornitore "${supplierName}" non trovato`);
          continue;
        }

        const productId = cellToString(row[IMPORT_COLUMNS.productId]) || undefined;
        let existing = productId
          ? await this.prisma.product.findUnique({
              where: { id: productId },
              include: { category: true },
            })
          : null;
        if (existing && existing.category.venueId !== venueId) {
          errors.push(`Riga ${rowNumber}: ID prodotto "${productId}" appartiene a un altro locale`);
          continue;
        }
        if (!existing) {
          existing = await this.prisma.product.findFirst({
            where: { name, category: { venueId } },
            include: { category: true },
          });
        }

        const sharedData = {
          name,
          unit,
          standardQty,
          categoryId: category.id,
          supplierId: supplier.id,
          reorderAt: cellToNumber(row[IMPORT_COLUMNS.reorderAt]) ?? null,
          supplierCode: cellToString(row[IMPORT_COLUMNS.supplierCode]) || null,
          costPerUnit: cellToNumber(row[IMPORT_COLUMNS.costPerUnit]) ?? null,
          unitsPerPackage: cellToNumber(row[IMPORT_COLUMNS.unitsPerPackage]) ?? null,
          active: cellToBoolean(row[IMPORT_COLUMNS.active], true),
        };

        if (existing) {
          await this.prisma.product.update({ where: { id: existing.id }, data: sharedData });
          updated++;
        } else {
          await this.prisma.product.create({
            data: { ...(productId ? { id: productId } : {}), ...sharedData },
          });
          created++;
        }
      } catch (err) {
        errors.push(`Riga ${rowNumber}: ${err instanceof Error ? err.message : 'errore sconosciuto'}`);
      }
    }

    return { created, updated, errors };
  }
}
