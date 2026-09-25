import { Body, Controller, Get, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { OnlineOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { CurrentUser, AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { OnlineOrdersService } from './online-orders.service';
import { RejectOnlineOrderDto } from './dto/reject-online-order.dto';
import { ProposeOrderTimeChangeDto } from './dto/propose-order-time-change.dto';
import { CompleteOnlineOrderDto } from './dto/complete-online-order.dto';

/** Coda e storico ordini online, lato admin/manager autorizzato (§5.10). */
@Controller('online-orders')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('onlineOrders')
export class OnlineOrdersController {
  constructor(private onlineOrdersService: OnlineOrdersService) {}

  /** Ordini ancora "vivi" (PENDING/CONFIRMED/READY), per la coda in tempo reale. */
  @Get()
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.onlineOrdersService.listQueue(requireVenueId(user));
  }

  /** Ordini conclusi (COMPLETED/REJECTED/CANCELLED di default), per lo storico separato dalla coda (§120). */
  @Get('history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.onlineOrdersService.listHistory(requireVenueId(user), {
      status: status ? (status.split(',') as OnlineOrderStatus[]) : undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Patch(':id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.onlineOrdersService.accept(user, requireVenueId(user), id);
  }

  @Patch(':id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RejectOnlineOrderDto) {
    return this.onlineOrdersService.reject(user, requireVenueId(user), id, dto);
  }

  @Patch(':id/ready')
  ready(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.onlineOrdersService.markReady(user, requireVenueId(user), id);
  }

  @Patch(':id/complete')
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteOnlineOrderDto,
  ) {
    return this.onlineOrdersService.complete(user, requireVenueId(user), id, dto);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.onlineOrdersService.cancel(user, requireVenueId(user), id);
  }

  /** Propone un nuovo orario al cliente (tipicamente per svuotare una fascia satura): non cambia subito l'ordine, chiede conferma via email. */
  @Patch(':id/time')
  proposeTimeChange(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProposeOrderTimeChangeDto,
  ) {
    return this.onlineOrdersService.proposeTimeChange(user, requireVenueId(user), id, dto);
  }

  /** Comanda cucina (§5.10): solo voci/varianti/modificatori/note, nessun prezzo/indirizzo. */
  @Get(':id/kitchen-ticket/pdf')
  async kitchenTicketPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.onlineOrdersService.exportKitchenTicketPdf(requireVenueId(user), id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="comanda-${id}.pdf"`,
    });
    res.send(buffer);
  }

  /** Scontrino completo (§5.10): dati cliente, indirizzo, prezzi, totale, pagamento. */
  @Get(':id/receipt/pdf')
  async fullReceiptPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.onlineOrdersService.exportFullReceiptPdf(requireVenueId(user), id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="scontrino-${id}.pdf"`,
    });
    res.send(buffer);
  }
}
