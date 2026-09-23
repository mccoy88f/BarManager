import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

/** Censimento tavoli, lato admin/manager autorizzato (§5.7). */
@Controller('reservations/tables')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('reservations')
export class TablesController {
  constructor(private tablesService: TablesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tablesService.list(requireVenueId(user));
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTableDto) {
    return this.tablesService.create(requireVenueId(user), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.update(requireVenueId(user), id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tablesService.remove(requireVenueId(user), id);
  }
}
