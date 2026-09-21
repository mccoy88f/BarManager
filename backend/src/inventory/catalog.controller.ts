import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private catalog: CatalogService) {}

  @Post('categories')
  @Roles(Role.ADMIN)
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(user.venueId, dto);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.listCategories(user.venueId);
  }

  @Post('suppliers')
  @Roles(Role.ADMIN)
  createSupplier(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.catalog.createSupplier(user.venueId, dto);
  }

  @Get('suppliers')
  listSuppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.listSuppliers(user.venueId);
  }

  @Post('products')
  @Roles(Role.ADMIN)
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Get('products')
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoryId') categoryId?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.catalog.listProducts(user.venueId, { categoryId, supplierId });
  }
}
