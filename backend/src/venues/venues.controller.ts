import {
  Body,
  Controller,
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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { safeExtension } from '../common/upload/safe-extension';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { UpdateVenueHoursDto } from './dto/update-venue-hours.dto';
import { UpdateClockInSettingsDto } from './dto/update-clock-in-settings.dto';
import { UpdateMenuSettingsDto } from './dto/update-menu-settings.dto';
import { UpdateAttendanceHistorySettingsDto } from './dto/update-attendance-history-settings.dto';

/** Gestione locali: esclusivamente Super Admin, salvo le rotte "me" (§5.4). */
@Controller('venues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class VenuesController {
  constructor(private venuesService: VenuesService) {}

  @Get()
  list() {
    return this.venuesService.listAll();
  }

  @Post()
  create(@Body() dto: CreateVenueDto) {
    return this.venuesService.create(dto);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body('active') active: boolean) {
    return this.venuesService.setActive(id, active);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVenueDto) {
    return this.venuesService.update(id, dto);
  }

  /** Il locale può vedere/modificare le proprie fasce orarie pranzo/cena. */
  @Get('me')
  @Roles(Role.ADMIN, Role.MANAGER)
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.getOwn(requireVenueId(user));
  }

  @Patch('me/hours')
  @Roles(Role.ADMIN)
  updateOwnHours(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateVenueHoursDto) {
    return this.venuesService.updateHours(requireVenueId(user), dto);
  }

  @Patch('me/clock-in-settings')
  @Roles(Role.ADMIN)
  updateOwnClockInSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateClockInSettingsDto,
  ) {
    return this.venuesService.updateClockInSettings(requireVenueId(user), dto);
  }

  /** Storico presenze visibile ai dipendenti + cancellazione automatica oltre una certa età. */
  @Patch('me/attendance-history-settings')
  @Roles(Role.ADMIN)
  updateOwnAttendanceHistorySettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAttendanceHistorySettingsDto,
  ) {
    return this.venuesService.updateAttendanceHistorySettings(requireVenueId(user), dto);
  }

  /** Contatti mostrati in fondo al menù pubblico: telefono e link social. */
  @Patch('me/menu-settings')
  @Roles(Role.ADMIN)
  updateOwnMenuSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMenuSettingsDto,
  ) {
    return this.venuesService.updateMenuSettings(requireVenueId(user), dto);
  }

  /** Immagine di copertina mostrata in alto nel menù pubblico. */
  @Post('me/menu-cover')
  @Roles(Role.ADMIN)
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
  uploadMenuCover(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.venuesService.setMenuCover(requireVenueId(user), `/uploads/menu/${file.filename}`);
  }
}
