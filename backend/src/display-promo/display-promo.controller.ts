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
import { CreateScreenDto } from './dto/create-screen.dto';
import { UpdateScreenDto } from './dto/update-screen.dto';
import { PairKioskDto } from './dto/pair-kiosk.dto';

/** Foto e video a tutto schermo: niente documenti/PDF come in KB, qui sono solo contenuti da proiettare. */
const ALLOWED_MEDIA_MIME = /^(image\/(jpe?g|png|webp|gif)|video\/(mp4|webm|ogg))$/;
/** Solo immagini per il logo dell'intestazione, niente video. */
const ALLOWED_LOGO_MIME = /^image\/(jpe?g|png|webp|gif|svg\+xml)$/;

/** Gestione admin di Display Promo (§5.12): CRUD playlist/contenuti (pool per locale) e CRUD display con la relativa programmazione settimanale (per schermo). */
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

  // ---- Display (schermi fisici) ------------------------------------------

  @Post('screens')
  @Roles(Role.ADMIN)
  createScreen(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateScreenDto) {
    return this.displayPromoService.createScreen(requireVenueId(user), dto);
  }

  @Get('screens')
  listScreens(@CurrentUser() user: AuthenticatedUser) {
    return this.displayPromoService.listScreens(requireVenueId(user));
  }

  @Patch('screens/:id')
  @Roles(Role.ADMIN)
  updateScreen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScreenDto,
  ) {
    return this.displayPromoService.updateScreen(requireVenueId(user), id, dto);
  }

  /** Logo personalizzato per l'intestazione in alto a sinistra (§5.12): ha sempre la precedenza su headerText/nome del locale. */
  @Post('screens/:id/header-logo')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: `${process.env.UPLOADS_DIR || './uploads'}/display-promo`,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${safeExtension(file.mimetype)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, un logo non ha bisogno di più
      fileFilter: (_req, file, cb) => cb(null, ALLOWED_LOGO_MIME.test(file.mimetype)),
    }),
  )
  uploadHeaderLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') screenId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.displayPromoService.setHeaderLogo(
      requireVenueId(user),
      screenId,
      `/uploads/display-promo/${file.filename}`,
    );
  }

  @Delete('screens/:id')
  @Roles(Role.ADMIN)
  removeScreen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.displayPromoService.removeScreen(requireVenueId(user), id);
  }

  @Get('screens/:id/schedule')
  listSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') screenId: string) {
    return this.displayPromoService.listSchedule(requireVenueId(user), screenId);
  }

  @Patch('screens/:id/schedule/:dayOfWeek/:shift')
  @Roles(Role.ADMIN)
  setScheduleSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') screenId: string,
    @Param('dayOfWeek') dayOfWeek: string,
    @Param('shift') shift: DisplayPromoShift,
    @Body() dto: SetScheduleSlotDto,
  ) {
    return this.displayPromoService.setScheduleSlot(
      requireVenueId(user),
      screenId,
      Number(dayOfWeek),
      shift,
      dto.playlistId,
    );
  }

  // ---- Dispositivi Kiosk Android abbinati allo schermo -------------------

  @Get('screens/:id/kiosks')
  listKiosks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') screenId: string,
  ) {
    return this.displayPromoService.listKiosksForScreen(requireVenueId(user), screenId);
  }

  @Post('screens/:id/kiosks')
  @Roles(Role.ADMIN)
  pairKiosk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') screenId: string,
    @Body() dto: PairKioskDto,
  ) {
    return this.displayPromoService.pairKioskToScreen(requireVenueId(user), screenId, dto);
  }

  @Delete('screens/:id/kiosks/:deviceId')
  @Roles(Role.ADMIN)
  unlinkKiosk(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') screenId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.displayPromoService.unlinkKioskFromScreen(
      requireVenueId(user),
      screenId,
      deviceId,
    );
  }
}
