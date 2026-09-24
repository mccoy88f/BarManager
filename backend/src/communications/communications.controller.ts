import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CommunicationType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { CommunicationsService } from './communications.service';
import { CreateCommunicationDto } from './dto/create-communication.dto';

/** Marketing/Comunicazioni clienti (§1-septdecies di DEVELOPMENT.md): stesso modulo "customers" della gestione anagrafica. */
@Controller('communications')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('customers')
export class CommunicationsController {
  constructor(private communicationsService: CommunicationsService) {}

  @Get('targetable-customers')
  listTargetableCustomers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type: CommunicationType,
  ) {
    return this.communicationsService.listTargetableCustomers(requireVenueId(user), type);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCommunicationDto) {
    return this.communicationsService.create(requireVenueId(user), user.userId, dto);
  }

  @Get()
  listHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.communicationsService.listHistory(requireVenueId(user));
  }

  @Get(':id')
  getDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.communicationsService.getDetail(requireVenueId(user), id);
  }
}
