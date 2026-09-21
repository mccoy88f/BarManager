import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // Categorie
  createCategory(venueId: string, dto: CreateCategoryDto) {
    return this.prisma.productCategory.create({ data: { ...dto, venueId } });
  }

  listCategories(venueId: string) {
    return this.prisma.productCategory.findMany({
      where: { venueId },
      include: { products: true },
      orderBy: { name: 'asc' },
    });
  }

  // Fornitori
  createSupplier(venueId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: { ...dto, ccEmails: dto.ccEmails ?? [], venueId },
    });
  }

  listSuppliers(venueId: string) {
    return this.prisma.supplier.findMany({ where: { venueId }, orderBy: { name: 'asc' } });
  }

  async updateSupplier(venueId: string, supplierId: string, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }
    return this.prisma.supplier.update({ where: { id: supplierId }, data: dto });
  }

  /** Fornitori il cui giorno di ordine ricorrente è oggi (usato in home). */
  listSuppliersDueToday(venueId: string) {
    const isoWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=lun .. 7=dom
    return this.prisma.supplier.findMany({
      where: { venueId, orderDays: { has: isoWeekday } },
      orderBy: { name: 'asc' },
    });
  }

  // Prodotti
  createProduct(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  listProducts(venueId: string, filters: { categoryId?: string; supplierId?: string }) {
    return this.prisma.product.findMany({
      where: {
        active: true,
        category: { venueId },
        categoryId: filters.categoryId,
        supplierId: filters.supplierId,
      },
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
    });
  }
}
