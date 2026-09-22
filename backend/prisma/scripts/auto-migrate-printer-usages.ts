/**
 * Migrazione automatica, eseguita a ogni avvio del backend (v. comando in
 * docker-compose*.yml), per il passaggio da "Printer.usage" (un solo uso
 * per stampante) a "Printer.usages" (lista di usi, una stampante può
 * servire più scopi insieme, es. HACCP e ordini). Su un database già
 * aggiornato o su un'installazione nuova non fa nulla (controllo alla riga
 * seguente): sicura da eseguire a ogni riavvio, non solo una volta.
 *
 * Stesso motivo dello script analogo per le varianti di menù
 * (auto-migrate-menu-variants.ts): un singolo "prisma db push" sullo
 * schema finale rimuoverebbe "usage" e creerebbe "usages" nello stesso
 * comando, perdendo l'uso già configurato per ogni stampante. Per
 * evitarlo, questo script:
 *   1. Verifica se la colonna "usage" esiste ancora su Printer (se no,
 *      esce subito: nulla da migrare).
 *   2. Se esiste, aggiunge SOLO "usages" (via SQL puro, senza toccare
 *      "usage") se non è già presente.
 *   3. Copia ogni "usage" esistente in "usages" (array con un elemento).
 *   4. Il "prisma db push" successivo (nel comando di avvio) troverà
 *      "usage" ormai priva di uno scopo e la rimuoverà senza perdere
 *      informazioni, perché sono già tutte in "usages".
 */
import { PrismaClient } from '@prisma/client';

async function columnExists(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) as exists`,
    table,
    column,
  );
  return rows[0]?.exists ?? false;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const needsMigration = await columnExists(prisma, 'Printer', 'usage');
    if (!needsMigration) {
      console.log('[auto-migrate-printer-usages] Nulla da migrare, database già aggiornato.');
      return;
    }

    console.log('[auto-migrate-printer-usages] Trovata "Printer.usage": avvio la migrazione a lista...');

    if (!(await columnExists(prisma, 'Printer', 'usages'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Printer" ADD COLUMN "usages" "PrinterUsage"[] NOT NULL DEFAULT ARRAY[]::"PrinterUsage"[]
      `);
      console.log('[auto-migrate-printer-usages] Colonna "usages" creata.');
    }

    const result = await prisma.$executeRawUnsafe(`
      UPDATE "Printer" SET "usages" = ARRAY["usage"] WHERE cardinality("usages") = 0
    `);

    console.log(
      `[auto-migrate-printer-usages] Migrate ${result} stampanti. ` +
        'La colonna "usage" verrà rimossa dal prossimo "prisma db push".',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[auto-migrate-printer-usages] Migrazione fallita:', err);
  process.exit(1);
});
