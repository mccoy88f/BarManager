import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
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
