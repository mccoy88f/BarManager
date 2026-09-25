import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { Response } from 'express';
import { safeExtension } from '../common/upload/safe-extension';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { MenuService } from './menu.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { ReorderMenuCategoriesDto } from './dto/reorder-menu-categories.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { SetUnavailableDto } from './dto/set-unavailable.dto';
import { CreateMenuModifierGroupDto } from './dto/create-menu-modifier-group.dto';
import { UpdateMenuModifierGroupDto } from './dto/update-menu-modifier-group.dto';

const XLSX_MIME_PATTERN = /spreadsheetml|ms-excel/;

// Niente @Roles(ADMIN, MANAGER): l'accesso al modulo Menù è governato da
// ModuleAccessGuard, concedibile per singolo dipendente dall'Admin.
/** Amministrazione del menù (Admin/Manager del locale, o Dipendente autorizzato). */
@Controller('menu')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('menu')
export class MenuController {
  constructor(private menuService: MenuService) {}

  @Post('categories')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMenuCategoryDto) {
    return this.menuService.createCategory(requireVenueId(user), dto);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.menuService.listCategories(requireVenueId(user));
  }

  /** Nuovo ordine dopo un drag&drop in UI: va registrata prima di "categories/:id". */
  @Patch('categories/reorder')
  reorderCategories(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderMenuCategoriesDto) {
    return this.menuService.reorderCategories(requireVenueId(user), dto.categoryIds);
  }

  @Patch('categories/:id/visibility')
  setCategoryVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('visible') visible: boolean,
  ) {
    return this.menuService.setCategoryVisibility(requireVenueId(user), id, visible);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMenuCategoryDto,
  ) {
    return this.menuService.updateCategory(requireVenueId(user), id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.menuService.removeCategory(requireVenueId(user), id);
  }

  @Post('items')
  createItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMenuItemDto) {
    return this.menuService.createItem(requireVenueId(user), dto);
  }

  @Get('items')
  listItems(@CurrentUser() user: AuthenticatedUser, @Query('categoryId') categoryId?: string) {
    return this.menuService.listItems(requireVenueId(user), categoryId);
  }

  /** Esporta le voci di menù in xlsx: sempre disponibile, anche con Loyverse attivo. */
  @Get('items/export/xlsx')
  async exportItemsXlsx(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const buffer = await this.menuService.exportXlsx(requireVenueId(user));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="menu.xlsx"',
    });
    res.send(buffer);
  }

  /** Importa/aggiorna voci di menù da xlsx: bloccato con Loyverse attivo (v. MenuService.importXlsx). */
  @Post('items/import/xlsx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        cb(null, XLSX_MIME_PATTERN.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.xlsx'));
      },
    }),
  )
  importItemsXlsx(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('File xlsx mancante');
    return this.menuService.importXlsx(requireVenueId(user), file.buffer);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateItem(requireVenueId(user), id, dto);
  }

  @Patch('items/:id/visibility')
  setVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('visible') visible: boolean,
  ) {
    return this.menuService.setVisibility(requireVenueId(user), id, visible);
  }

  @Patch('items/:id/featured')
  setFeatured(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('featured') featured: boolean,
  ) {
    return this.menuService.setFeatured(requireVenueId(user), id, featured);
  }

  @Patch('items/:id/unavailable')
  setUnavailable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetUnavailableDto,
  ) {
    return this.menuService.setUnavailableUntil(requireVenueId(user), id, dto.until);
  }

  @Delete('items/:id')
  deleteItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.menuService.deleteItem(requireVenueId(user), id);
  }

  @Post('items/:id/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: `${process.env.UPLOADS_DIR || './uploads'}/menu`,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${safeExtension(file.mimetype)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        cb(null, /^image\/(jpe?g|png|webp)$/.test(file.mimetype));
      },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.menuService.setPhoto(requireVenueId(user), id, `/uploads/menu/${file.filename}`);
  }

  @Post('modifier-groups')
  createModifierGroup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMenuModifierGroupDto) {
    return this.menuService.createModifierGroup(requireVenueId(user), dto);
  }

  @Get('modifier-groups')
  listModifierGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.menuService.listModifierGroups(requireVenueId(user));
  }

  @Patch('modifier-groups/:id')
  updateModifierGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMenuModifierGroupDto,
  ) {
    return this.menuService.updateModifierGroup(requireVenueId(user), id, dto);
  }

  @Delete('modifier-groups/:id')
  removeModifierGroup(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.menuService.removeModifierGroup(requireVenueId(user), id);
  }
}
