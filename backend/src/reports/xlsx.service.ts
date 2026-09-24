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

  /**
   * Legge il primo foglio di un XLS caricato dall'utente: prima riga come
   * intestazioni, una riga per ogni oggetto restituito (chiave = testo
   * dell'intestazione, valore = valore grezzo della cella — stringa,
   * numero, `Date` per celle data/ora, o `null`). Righe completamente
   * vuote vengono saltate. Generico, non specifico a un singolo modulo.
   */
  async readSheet(buffer: Buffer): Promise<Record<string, unknown>[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? '').trim();
    });

    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;
        obj[header] = cell.value;
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    return rows;
  }
}
