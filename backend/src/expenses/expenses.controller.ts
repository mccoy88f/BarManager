import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ModuleAccessGuard } from '../common/guards/module-access.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

/** Spese del locale (§5.5 di DEVELOPMENT.md): mai concedibile al ruolo Dipendente, v. ModuleAccessGuard. */
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('expenses')
export class ExpensesController {
  constructor(private expenses: ExpensesService) {}

  @Post('payment-methods')
  createPaymentMethod(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentMethodDto) {
    return this.expenses.createPaymentMethod(requireVenueId(user), dto);
  }

  @Get('payment-methods')
  listPaymentMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.expenses.listPaymentMethods(requireVenueId(user));
  }

  @Patch('payment-methods/:id')
  updatePaymentMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.expenses.updatePaymentMethod(requireVenueId(user), id, dto);
  }

  @Delete('payment-methods/:id')
  removePaymentMethod(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expenses.removePaymentMethod(requireVenueId(user), id);
  }

  @Post('wallets')
  createWallet(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWalletDto) {
    return this.expenses.createWallet(requireVenueId(user), dto);
  }

  @Get('wallets')
  listWallets(@CurrentUser() user: AuthenticatedUser) {
    return this.expenses.listWallets(requireVenueId(user));
  }

  @Patch('wallets/:id')
  updateWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.expenses.updateWallet(requireVenueId(user), id, dto);
  }

  @Delete('wallets/:id')
  removeWallet(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expenses.removeWallet(requireVenueId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto) {
    return this.expenses.createExpense(requireVenueId(user), user.userId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('walletId') walletId?: string,
    @Query('origin') origin?: 'linked' | 'standalone',
  ) {
    return this.expenses.list(requireVenueId(user), {
      dateFrom,
      dateTo,
      paymentMethodId,
      walletId,
      origin,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.updateExpense(requireVenueId(user), id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.expenses.removeExpense(requireVenueId(user), id);
  }
}
