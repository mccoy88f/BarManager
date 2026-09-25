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
import { diskStorage, memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
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
import { UpdateOpeningHoursDto } from './dto/update-opening-hours.dto';
import { UpdateClockInSettingsDto } from './dto/update-clock-in-settings.dto';
import { UpdateMenuSettingsDto } from './dto/update-menu-settings.dto';
import { UpdateAttendanceHistorySettingsDto } from './dto/update-attendance-history-settings.dto';
import { UpdateReservationSettingsDto } from './dto/update-reservation-settings.dto';
import { UpdateOnlineOrdersSettingsDto } from './dto/update-online-orders-settings.dto';
import { UpdateSumUpSettingsDto } from './dto/update-sumup-settings.dto';
import { UpdateSumUpPaymentMethodsDto } from './dto/update-sumup-payment-methods.dto';
import { UpsertSpecialDayDto } from './dto/upsert-special-day.dto';

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

  /** Il locale può vedere/modificare i propri orari di apertura. */
  @Get('me')
  @Roles(Role.ADMIN, Role.MANAGER)
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.getOwn(requireVenueId(user));
  }

  /** Orari di apertura settimanali (giorni chiusi, fino a due fasce orarie al giorno). */
  @Patch('me/opening-hours')
  @Roles(Role.ADMIN)
  updateOwnOpeningHours(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOpeningHoursDto) {
    return this.venuesService.updateOpeningHours(requireVenueId(user), dto);
  }

  /** Fasce pranzo/cena del menù (§5.10), pagina "Impostazioni Menù" — decoupled dall'orario reale sopra. */
  @Patch('me/menu-hours')
  @Roles(Role.ADMIN)
  updateOwnMenuHours(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOpeningHoursDto) {
    return this.venuesService.updateMenuHours(requireVenueId(user), dto);
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

  /**
   * Logo mostrato in alto nelle email di prenotazione inviate ai clienti
   * (distinto dalla copertina del menù). Convertito sempre in PNG con
   * `sharp` a prescindere dal formato caricato (jpeg/png/webp): il webp,
   * per quanto comodo per la trasparenza sul web, non è supportato in modo
   * affidabile dai client email (es. Outlook) e la trasparenza risultava
   * mostrata con uno sfondo nero al posto del trasparente — il PNG, che
   * gestisce comunque la trasparenza, non ha questo problema. Ridimensionato
   * in altezza (240px, senza allargare immagini più piccole) perché in
   * email è mostrato al massimo a 80px: 3x basta per gli schermi retina
   * senza portarsi dietro il peso del file originale. I loghi caricati
   * prima di questa modifica restano nel loro formato originale finché non
   * vengono ri-caricati.
   */
  @Post('me/logo')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        cb(null, /^image\/(jpe?g|png|webp)$/.test(file.mimetype));
      },
    }),
  )
  async uploadLogo(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File) {
    const filename = `${randomUUID()}.png`;
    const destination = `${process.env.UPLOADS_DIR || './uploads'}/venues/${filename}`;
    await sharp(file.buffer).resize({ height: 240, withoutEnlargement: true }).png().toFile(destination);
    return this.venuesService.setLogo(requireVenueId(user), `/uploads/venues/${filename}`);
  }

  /** Impostazioni del modulo Prenotazioni (§5.7): soglia conferma automatica, durata slot, orizzonte. */
  @Patch('me/reservation-settings')
  @Roles(Role.ADMIN)
  updateOwnReservationSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateReservationSettingsDto,
  ) {
    return this.venuesService.updateReservationSettings(requireVenueId(user), dto);
  }

  /** Impostazioni del modulo Ordini online (§5.10): interruttori, consegna, accettazione automatica, mappatura Loyverse. */
  @Patch('me/online-orders-settings')
  @Roles(Role.ADMIN)
  updateOwnOnlineOrdersSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOnlineOrdersSettingsDto,
  ) {
    return this.venuesService.updateOnlineOrdersSettings(requireVenueId(user), dto);
  }

  /** Orari specifici per gli ordini online, se diversi da quelli generali del locale. */
  @Patch('me/online-orders-opening-hours')
  @Roles(Role.ADMIN)
  updateOwnOnlineOrdersOpeningHours(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOpeningHoursDto,
  ) {
    return this.venuesService.updateOnlineOrdersOpeningHours(requireVenueId(user), dto);
  }

  /** Credenziali SumUp del locale (Online Payments API), cifrate come il token Loyverse. */
  @Patch('me/sumup-settings')
  @Roles(Role.ADMIN)
  updateOwnSumUpSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSumUpSettingsDto) {
    return this.venuesService.updateSumUpSettings(requireVenueId(user), dto);
  }

  /** Interroga i metodi di pagamento davvero disponibili per l'account SumUp collegato (§5.10). */
  @Post('me/sumup-verify-payment-methods')
  @Roles(Role.ADMIN)
  verifySumUpPaymentMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.verifySumUpPaymentMethods(requireVenueId(user));
  }

  /** Metodi di pagamento SumUp scelti dall'admin tra quelli disponibili. */
  @Patch('me/sumup-payment-methods')
  @Roles(Role.ADMIN)
  updateOwnSumUpPaymentMethods(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSumUpPaymentMethodsDto,
  ) {
    return this.venuesService.updateSumUpPaymentMethods(requireVenueId(user), dto);
  }

  /** Aperture speciali (§5.10): sovrascrivono per una data l'orario reale e/o gli orari pranzo/cena del menù. */
  @Get('me/special-days')
  @Roles(Role.ADMIN)
  listOwnSpecialDays(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.listSpecialDays(requireVenueId(user));
  }

  @Post('me/special-days')
  @Roles(Role.ADMIN)
  upsertOwnSpecialDay(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertSpecialDayDto) {
    return this.venuesService.upsertSpecialDay(requireVenueId(user), dto);
  }

  @Delete('me/special-days/:id')
  @Roles(Role.ADMIN)
  removeOwnSpecialDay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.venuesService.removeSpecialDay(requireVenueId(user), id);
  }

  /** Metodi di pagamento configurati dal locale nel proprio Back Office Loyverse, per la mappatura in Impostazioni. */
  @Get('me/loyverse-payment-types')
  @Roles(Role.ADMIN)
  listOwnLoyversePaymentTypes(@CurrentUser() user: AuthenticatedUser) {
    return this.venuesService.listLoyversePaymentTypes(requireVenueId(user));
  }
}
