import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
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
import { ExpensesService } from './expenses.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { XlsxService } from '../reports/xlsx.service';
import { PdfService } from '../reports/pdf.service';

/** Spese del locale (§5.5 di DEVELOPMENT.md): mai concedibile al ruolo Dipendente, v. ModuleAccessGuard. */
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('expenses')
export class ExpensesController {
  constructor(
    private expenses: ExpensesService,
    private xlsx: XlsxService,
    private pdf: PdfService,
  ) {}

  /** Elenco leggero per il selettore/filtro fornitore qui, indipendente dal modulo "inventory". */
  @Get('suppliers')
  listSuppliers(@CurrentUser() user: AuthenticatedUser) {
    return this.expenses.listSuppliersBasic(requireVenueId(user));
  }

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

  /** Query comuni a list()/escpos()/export, in un unico posto perché sono le stesse 7 in ciascuno dei 4 endpoint. */
  private buildFilters(q: {
    dateFrom?: string;
    dateTo?: string;
    paymentMethodId?: string;
    walletId?: string;
    origin?: 'linked' | 'standalone';
    supplierId?: string;
    onlyManual?: string;
  }) {
    return {
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      paymentMethodId: q.paymentMethodId,
      walletId: q.walletId,
      origin: q.origin,
      supplierId: q.supplierId,
      onlyManual: q.onlyManual === 'true',
    };
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
    @Query('supplierId') supplierId?: string,
    @Query('onlyManual') onlyManual?: string,
  ) {
    return this.expenses.list(
      requireVenueId(user),
      this.buildFilters({ dateFrom, dateTo, paymentMethodId, walletId, origin, supplierId, onlyManual }),
    );
  }

  /** Stesso elenco filtrato di list(), come sezione strutturata per la stampa ESC/POS dall'app nativa (§5.11). */
  @Get('escpos')
  async escpos(
    @CurrentUser() user: AuthenticatedUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('walletId') walletId?: string,
    @Query('origin') origin?: 'linked' | 'standalone',
    @Query('supplierId') supplierId?: string,
    @Query('onlyManual') onlyManual?: string,
  ) {
    const sections = await this.expenses.getEscposSections(
      requireVenueId(user),
      this.buildFilters({ dateFrom, dateTo, paymentMethodId, walletId, origin, supplierId, onlyManual }),
    );
    return { sections };
  }

  /** Report XLS: stessi filtri di list(), una riga per spesa/pagamento + totale finale. */
  @Get('export/xlsx')
  async exportXlsx(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('walletId') walletId?: string,
    @Query('origin') origin?: 'linked' | 'standalone',
    @Query('supplierId') supplierId?: string,
    @Query('onlyManual') onlyManual?: string,
  ) {
    const expenses = await this.expenses.list(
      requireVenueId(user),
      this.buildFilters({ dateFrom, dateTo, paymentMethodId, walletId, origin, supplierId, onlyManual }),
    );
    const rows = expenses.map((e) => ({
      date: e.date.toLocaleDateString('it-IT'),
      description: e.description,
      supplier: e.supplier?.name ?? 'Libero',
      paymentMethod: e.paymentMethod.name,
      wallet: e.wallet.name,
      origin: e.task ? `Scadenza: ${e.task.title}` : 'Autonoma',
      amount: e.amount,
    }));
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    rows.push({
      date: '',
      description: '',
      supplier: '',
      paymentMethod: '',
      wallet: '',
      origin: 'TOTALE',
      amount: total,
    });
    const buffer = await this.xlsx.buildSheet(
      'Pagamenti',
      [
        { header: 'Data', key: 'date', width: 14 },
        { header: 'Descrizione', key: 'description', width: 36 },
        { header: 'Fornitore', key: 'supplier', width: 24 },
        { header: 'Metodo', key: 'paymentMethod', width: 20 },
        { header: 'Portafoglio', key: 'wallet', width: 20 },
        { header: 'Origine', key: 'origin', width: 24 },
        { header: 'Importo (€)', key: 'amount', width: 14 },
      ],
      rows,
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="pagamenti.xlsx"',
    });
    res.send(buffer);
  }

  /** Report PDF: stessi filtri di list(), tabellare su A4 (a differenza dello scontrino 80mm di escpos/getReceiptSections). */
  @Get('export/pdf')
  async exportPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('walletId') walletId?: string,
    @Query('origin') origin?: 'linked' | 'standalone',
    @Query('supplierId') supplierId?: string,
    @Query('onlyManual') onlyManual?: string,
  ) {
    const expenses = await this.expenses.list(
      requireVenueId(user),
      this.buildFilters({ dateFrom, dateTo, paymentMethodId, walletId, origin, supplierId, onlyManual }),
    );
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);

    const buffer = await this.pdf.buildDocument((doc) => {
      doc.fontSize(16).text('Report Pagamenti', { align: 'center' }).moveDown();
      doc.fontSize(9);
      if (dateFrom || dateTo) {
        doc.text(`Periodo: ${dateFrom ?? '…'} — ${dateTo ?? '…'}`).moveDown(0.5);
      }
      for (const e of expenses) {
        doc.text(
          `${e.date.toLocaleDateString('it-IT')}  €${e.amount.toFixed(2)}  —  ${e.description}  ` +
            `[${e.supplier?.name ?? 'Libero'}]  (${e.paymentMethod.name} — ${e.wallet.name})` +
            `${e.task ? `  Scadenza: ${e.task.title}` : ''}`,
        );
      }
      if (expenses.length === 0) {
        doc.text('Nessun pagamento nel periodo/filtro selezionato.');
      }
      doc.moveDown().fontSize(12).text(`TOTALE: € ${total.toFixed(2)}`, { align: 'right' });
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="pagamenti.pdf"',
    });
    res.send(buffer);
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
