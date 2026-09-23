import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  constructor(private prisma: PrismaService) {}

  list(venueId: string) {
    return this.prisma.table.findMany({ where: { venueId }, orderBy: { seats: 'asc' } });
  }

  create(venueId: string, dto: CreateTableDto) {
    return this.prisma.table.create({ data: { venueId, label: dto.label, seats: dto.seats } });
  }

  async update(venueId: string, tableId: string, dto: UpdateTableDto) {
    await this.requireOwnTable(venueId, tableId);
    return this.prisma.table.update({ where: { id: tableId }, data: dto });
  }

  /**
   * Elimina il tavolo: sulle prenotazioni che lo referenziavano tableId
   * torna a null (relazione opzionale). Per ritirare un tavolo senza
   * perdere lo storico delle prenotazioni assegnate, usare "active: false"
   * invece di eliminarlo.
   */
  async remove(venueId: string, tableId: string) {
    await this.requireOwnTable(venueId, tableId);
    await this.prisma.table.delete({ where: { id: tableId } });
  }

  private async requireOwnTable(venueId: string, tableId: string) {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.venueId !== venueId) {
      throw new NotFoundException('Tavolo non trovato');
    }
    return table;
  }
}
