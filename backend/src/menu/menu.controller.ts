import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { MenuService } from './menu.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { SetUnavailableDto } from './dto/set-unavailable.dto';

/** Amministrazione del menù (Admin/Manager del locale). */
@Controller('menu')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
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

  @Patch('categories/:id/move')
  moveCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('direction') direction: 'up' | 'down',
  ) {
    return this.menuService.moveCategory(requireVenueId(user), id, direction);
  }

  @Post('items')
  createItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMenuItemDto) {
    return this.menuService.createItem(requireVenueId(user), dto);
  }

  @Get('items')
  listItems(@CurrentUser() user: AuthenticatedUser, @Query('categoryId') categoryId?: string) {
    return this.menuService.listItems(requireVenueId(user), categoryId);
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
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
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
}
