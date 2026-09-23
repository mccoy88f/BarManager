import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateOrdersByCategoryDto } from './dto/create-orders-by-category.dto';
import { SendOrdersBatchDto } from './dto/send-orders-batch.dto';
import { UpdateOrderLineDto } from './dto/update-order-line.dto';

// Niente @Roles(ADMIN, MANAGER) qui: l'accesso al modulo Inventario è
// governato da ModuleAccessGuard (l'Admin può concederlo anche a un
// Dipendente, indipendentemente dal ruolo — vedi Employees.allowedModules).
@Controller('inventory/orders')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('inventory')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(user, dto);
  }

  /** Un ordine per categoria: diviso in un ordine per fornitore. */
  @Post('by-category')
  createByCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrdersByCategoryDto,
  ) {
    return this.ordersService.createOrdersByCategory(user, dto);
  }

  /** Invia più ordini (uno per fornitore) in un colpo, dopo una creazione per categoria. */
  @Post('send-batch')
  sendBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendOrdersBatchDto) {
    return this.ordersService.sendOrders(user, dto.orderIds);
  }

  /** PDF di più ordini, una pagina per fornitore. */
  @Get('export/pdf-batch')
  async exportBatchPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Query('ids') ids: string,
    @Res() res: Response,
  ) {
    const orderIds = ids.split(',').filter(Boolean);
    const buffer = await this.ordersService.exportBatchPdf(requireVenueId(user), orderIds);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="ordini.pdf"',
    });
    res.send(buffer);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.listOrders(requireVenueId(user));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ordersService.getOrder(requireVenueId(user), id);
  }

  @Patch(':id/lines/:lineId')
  updateLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateOrderLineDto,
  ) {
    return this.ordersService.updateLineQty(requireVenueId(user), id, lineId, dto.orderedQty);
  }

  @Post(':id/send')
  send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ordersService.sendOrder(user, id);
  }

  @Get(':id/export/pdf')
  async exportPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.ordersService.exportPdf(requireVenueId(user), id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ordine-${id}.pdf"`,
    });
    res.send(buffer);
  }
}
