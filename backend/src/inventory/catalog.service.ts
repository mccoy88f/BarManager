import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isoWeekdayInZone } from '../common/timezone/timezone';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

export type ProductTrend = 'UP' | 'DOWN' | 'STABLE' | null;

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
  constructor(private prisma: PrismaService) {}

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
}
