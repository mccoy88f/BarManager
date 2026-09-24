import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const XLSX_MIME_PATTERN = /spreadsheetml|ms-excel/;

/** Anagrafica clienti, lato admin/manager autorizzato (§5.8 di DEVELOPMENT.md). */
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule('customers')
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.customersService.list(requireVenueId(user));
  }

  /** Esporta l'anagrafica in xlsx: stesso formato accettato da import/xlsx, per poter riesportare/reimportare a giro. */
  @Get('export/xlsx')
  async exportXlsx(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const buffer = await this.customersService.exportXlsx(requireVenueId(user));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clienti.xlsx"',
    });
    res.send(buffer);
  }

  /** Importa/aggiorna clienti da xlsx (v. CustomersService.importXlsx per la logica di confronto). */
  @Post('import/xlsx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        cb(null, XLSX_MIME_PATTERN.test(file.mimetype) || file.originalname.toLowerCase().endsWith('.xlsx'));
      },
    }),
  )
  importXlsx(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('File xlsx mancante');
    return this.customersService.importXlsx(requireVenueId(user), file.buffer);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.get(requireVenueId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(requireVenueId(user), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(requireVenueId(user), id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.remove(requireVenueId(user), id);
  }
}
