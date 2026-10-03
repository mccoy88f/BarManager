/**
 * Migrazione automatica, eseguita a ogni avvio del backend (v. comando in
 * docker-compose*.yml) PRIMA di "prisma db push", per il passaggio dalle tre
 * categorie generiche di PrinterUsage (HACCP/ORDERS/GENERIC) ai tipi
 * granulari per documento (SUPPLIER_ORDER/ONLINE_ORDER_KITCHEN_TICKET/
 * ONLINE_ORDER_RECEIPT/HACCP_REPORT/EXPENSES_REPORT), introdotti per
 * l'instradamento automatico delle stampe dall'app Android nativa (§5.11
 * di docs/DEVELOPMENT.md). Su un database già aggiornato o su
 * un'installazione nuova non fa nulla: sicura da eseguire a ogni riavvio.
 *
 * "prisma db push --accept-data-loss" non può da solo rinominare i valori
 * di un enum: li tratterebbe come rimossi (i vecchi) e aggiunti (i nuovi),
 * fallendo se una riga usa ancora un valore rimosso. Questo script quindi,
 * mentre l'enum ha ancora sia i vecchi che i nuovi valori ammessi:
 *   1. Aggiunge i nuovi valori all'enum "PrinterUsage" via SQL puro, se non
 *      già presenti (ALTER TYPE ... ADD VALUE, operazione additiva, sempre
 *      sicura anche con l'enum finale non ancora applicato).
 *   2. Rimappa ogni valore vecchio nell'equivalente nuovo più vicino:
 *      HACCP -> HACCP_REPORT, ORDERS (ieri "checklist ordini fornitori")
 *      -> SUPPLIER_ORDER. GENERIC non ha un corrispondente specifico (era
 *      solo un'etichetta, mai usata per un instradamento automatico reale)
 *      e viene rimosso dagli array invece di essere rimappato: l'admin
 *      riassegna i tipi dalla UI se la stampante va usata per i nuovi
 *      documenti (comanda cucina, scontrino ordini online, report Spese).
 *   3. Il "prisma db push --accept-data-loss" successivo trova l'enum con
 *      zero righe sui vecchi valori e può quindi ricrearlo con il solo
 *      set finale, senza perdere le assegnazioni già rimappate.
 */
import { PrismaClient } from '@prisma/client';

async function enumValueExists(prisma: PrismaClient, enumName: string, value: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = $1 AND e.enumlabel = $2
     ) as exists`,
    enumName,
    value,
  );
  return rows[0]?.exists ?? false;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const hasOldValues = await enumValueExists(prisma, 'PrinterUsage', 'ORDERS');
    if (!hasOldValues) {
      console.log('[auto-migrate-printer-usage-types] Nulla da migrare, enum già aggiornato.');
      return;
    }

    console.log('[auto-migrate-printer-usage-types] Trovati i vecchi valori HACCP/ORDERS/GENERIC: avvio la rimappatura...');

    for (const newValue of [
      'SUPPLIER_ORDER',
      'ONLINE_ORDER_KITCHEN_TICKET',
      'ONLINE_ORDER_RECEIPT',
      'HACCP_REPORT',
      'EXPENSES_REPORT',
    ]) {
      if (!(await enumValueExists(prisma, 'PrinterUsage', newValue))) {
        await prisma.$executeRawUnsafe(`ALTER TYPE "PrinterUsage" ADD VALUE '${newValue}'`);
      }
    }

    const haccpCount = await prisma.$executeRawUnsafe(`
      UPDATE "Printer" SET usages = array_replace(usages, 'HACCP'::"PrinterUsage", 'HACCP_REPORT'::"PrinterUsage")
      WHERE 'HACCP'::"PrinterUsage" = ANY(usages)
    `);
    const ordersCount = await prisma.$executeRawUnsafe(`
      UPDATE "Printer" SET usages = array_replace(usages, 'ORDERS'::"PrinterUsage", 'SUPPLIER_ORDER'::"PrinterUsage")
      WHERE 'ORDERS'::"PrinterUsage" = ANY(usages)
    `);
    const genericCount = await prisma.$executeRawUnsafe(`
      UPDATE "Printer" SET usages = array_remove(usages, 'GENERIC'::"PrinterUsage")
      WHERE 'GENERIC'::"PrinterUsage" = ANY(usages)
    `);

    console.log(
      `[auto-migrate-printer-usage-types] Rimappate ${haccpCount} stampanti HACCP->HACCP_REPORT, ` +
        `${ordersCount} ORDERS->SUPPLIER_ORDER, rimosso GENERIC da ${genericCount} stampanti. ` +
        'I vecchi valori verranno rimossi dall\'enum dal prossimo "prisma db push".',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[auto-migrate-printer-usage-types] Migrazione fallita:', err);
  process.exit(1);
});
