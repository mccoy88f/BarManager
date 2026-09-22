import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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

  /** Fornitori il cui giorno di ordine ricorrente è oggi (usato in home). */
  listSuppliersDueToday(venueId: string) {
    const isoWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=lun .. 7=dom
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
}
