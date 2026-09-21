import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

@Injectable()
export class XlsxService {
  /** Costruisce un file XLS in memoria da un elenco di colonne + righe. */
  async buildSheet(
    sheetName: string,
    columns: { header: string; key: string; width?: number }[],
    rows: Record<string, unknown>[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    rows.forEach((row) => sheet.addRow(row));
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
