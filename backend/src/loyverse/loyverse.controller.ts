import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { LoyverseService } from './loyverse.service';
import { UpdateLoyverseSettingsDto } from './dto/update-loyverse-settings.dto';

/** Integrazione Loyverse: catalogo/prezzi/immagini gestiti da Loyverse, solo Admin. */
@Controller('loyverse')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class LoyverseController {
  constructor(private loyverseService: LoyverseService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.loyverseService.getStatus(requireVenueId(user));
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLoyverseSettingsDto,
  ) {
    return this.loyverseService.updateSettings(requireVenueId(user), dto);
  }

  @Post('sync')
  sync(@CurrentUser() user: AuthenticatedUser) {
    return this.loyverseService.syncNow(requireVenueId(user));
  }
}
