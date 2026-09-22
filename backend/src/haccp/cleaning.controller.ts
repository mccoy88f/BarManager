import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { CleaningService } from './cleaning.service';
import { CreateCleaningTaskDto } from './dto/create-cleaning-task.dto';

@Controller('haccp/cleaning-tasks')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('haccp')
export class CleaningController {
  constructor(private cleaningService: CleaningService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCleaningTaskDto) {
    return this.cleaningService.createTask(requireVenueId(user), dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.cleaningService.listTasks(requireVenueId(user));
  }

  /** Voci del periodo corrente da fare, viste da chiunque abbia accesso al modulo HACCP. */
  @Get('due')
  listDue(@CurrentUser() user: AuthenticatedUser) {
    return this.cleaningService.listDueToday(requireVenueId(user));
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cleaningService.complete(user, id);
  }

  /** Storico di chi ha pulito cosa e quando: riservato ad admin/responsabili. */
  @Get('logs')
  @Roles(Role.ADMIN, Role.MANAGER)
  listLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.cleaningService.listLogs(requireVenueId(user), from, to);
  }
}
