import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('inventory')
export class CatalogController {
  constructor(private catalog: CatalogService) {}

  @Post('categories')
  @Roles(Role.ADMIN)
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(requireVenueId(user), dto);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.listCategories(requireVenueId(user));
  }

  @Patch('categories/:id')
  @Roles(Role.ADMIN)
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(requireVenueId(user), id, dto);
  }

  @Delete('categories/:id')
  @Roles(Role.ADMIN)
  removeCategory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.catalog.removeCategory(requireVenueId(user), id);
  }

  @Post('suppliers')
  @Roles(Role.ADMIN)
  createSupplier(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.catalog.createSupplier(requireVenueId(user), dto);
  }

  @Get('suppliers')
  listSuppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.listSuppliers(requireVenueId(user));
  }

  @Patch('suppliers/:id')
  @Roles(Role.ADMIN)
  updateSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.catalog.updateSupplier(requireVenueId(user), id, dto);
  }

  @Delete('suppliers/:id')
  @Roles(Role.ADMIN)
  removeSupplier(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.catalog.removeSupplier(requireVenueId(user), id);
  }

  @Post('products')
  @Roles(Role.ADMIN)
  createProduct(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(requireVenueId(user), dto);
  }

  @Get('products')
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoryId') categoryId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalog.listProducts(requireVenueId(user), {
      categoryId,
      supplierId,
      includeInactive: includeInactive === 'true',
    });
  }

  /** Trend di vendita per prodotto dedotto dagli ultimi ordini al fornitore. */
  @Get('products/trend')
  getProductTrends(@CurrentUser() user: AuthenticatedUser, @Query('ids') ids: string) {
    const productIds = (ids ?? '').split(',').filter(Boolean);
    return this.catalog.getProductTrends(requireVenueId(user), productIds);
  }

  @Patch('products/:id')
  @Roles(Role.ADMIN)
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(requireVenueId(user), id, dto);
  }
}
