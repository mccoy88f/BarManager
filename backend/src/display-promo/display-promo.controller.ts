import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { DisplayPromoMediaType, DisplayPromoShift } from '@prisma/client';
import { safeExtension } from '../common/upload/safe-extension';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { DisplayPromoService } from './display-promo.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ReorderMediaDto } from './dto/reorder-media.dto';
import { SetScheduleSlotDto } from './dto/set-schedule-slot.dto';

/** Foto e video a tutto schermo: niente documenti/PDF come in KB, qui sono solo contenuti da proiettare. */
const ALLOWED_MEDIA_MIME = /^(image\/(jpe?g|png|webp|gif)|video\/(mp4|webm|ogg))$/;

/** Gestione admin delle playlist Display Promo (§5.12): CRUD playlist/contenuti e programmazione settimanale. */
@Controller('display-promo')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('displayPromo')
export class DisplayPromoController {
  constructor(private displayPromoService: DisplayPromoService) {}

  @Post('playlists')
  @Roles(Role.ADMIN)
  createPlaylist(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlaylistDto) {
    return this.displayPromoService.createPlaylist(requireVenueId(user), dto);
  }

  @Get('playlists')
  listPlaylists(@CurrentUser() user: AuthenticatedUser) {
    return this.displayPromoService.listPlaylists(requireVenueId(user));
  }

  @Patch('playlists/:id')
  @Roles(Role.ADMIN)
  updatePlaylist(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.displayPromoService.updatePlaylist(requireVenueId(user), id, dto);
  }

  @Delete('playlists/:id')
  @Roles(Role.ADMIN)
  removePlaylist(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.displayPromoService.removePlaylist(requireVenueId(user), id);
  }

  /** Carica una foto o un breve video e lo aggiunge in coda alla playlist. */
  @Post('playlists/:id/media')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: `${process.env.UPLOADS_DIR || './uploads'}/display-promo`,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${safeExtension(file.mimetype)}`),
      }),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB: schermi a tutto schermo, video anche di diversi minuti
      fileFilter: (_req, file, cb) => cb(null, ALLOWED_MEDIA_MIME.test(file.mimetype)),
    }),
  )
  uploadMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') playlistId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const type = file.mimetype.startsWith('video/') ? DisplayPromoMediaType.VIDEO : DisplayPromoMediaType.PHOTO;
    return this.displayPromoService.addMedia(requireVenueId(user), playlistId, {
      type,
      url: `/uploads/display-promo/${file.filename}`,
    });
  }

  @Patch('media/:id')
  @Roles(Role.ADMIN)
  updateMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.displayPromoService.updateMedia(requireVenueId(user), id, dto);
  }

  @Delete('media/:id')
  @Roles(Role.ADMIN)
  removeMedia(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.displayPromoService.removeMedia(requireVenueId(user), id);
  }

  @Patch('playlists/:id/media/reorder')
  @Roles(Role.ADMIN)
  reorderMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') playlistId: string,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.displayPromoService.reorderMedia(requireVenueId(user), playlistId, dto.mediaIds);
  }

  @Get('schedule')
  listSchedule(@CurrentUser() user: AuthenticatedUser) {
    return this.displayPromoService.listSchedule(requireVenueId(user));
  }

  @Patch('schedule/:dayOfWeek/:shift')
  @Roles(Role.ADMIN)
  setScheduleSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dayOfWeek') dayOfWeek: string,
    @Param('shift') shift: DisplayPromoShift,
    @Body() dto: SetScheduleSlotDto,
  ) {
    return this.displayPromoService.setScheduleSlot(requireVenueId(user), Number(dayOfWeek), shift, dto.playlistId);
  }
}
