/**
 * Migrazione automatica, eseguita a ogni avvio del backend (v. comando in
 * docker-compose*.yml), per il passaggio da "MenuItem.price" (un prezzo
 * unico per voce di menù) al modello a varianti ("MenuItemVariant", più
 * righe prezzo per voce). Su un database già aggiornato o su
 * un'installazione nuova non fa nulla (controllo alla riga seguente):
 * sicura da eseguire a ogni riavvio, non solo una volta.
 *
 * Il progetto usa "prisma db push" senza cronologia di migrazioni: un
 * singolo "db push" sullo schema finale applicherebbe la rimozione di
 * "price" e la creazione di "MenuItemVariant" nello stesso comando,
 * perdendo i prezzi già salvati. Per evitarlo, questo script:
 *   1. Verifica se la colonna "price" esiste ancora su MenuItem (se no,
 *      esce subito: nulla da migrare).
 *   2. Se esiste, applica uno schema temporaneo che aggiunge SOLO
 *      "MenuItemVariant" (via SQL puro, senza toccare "price").
 *   3. Copia ogni prezzo esistente in una variante ("" come nome).
 *   4. Il "prisma db push" successivo (nel comando di avvio) troverà
 *      "price" ormai priva di uno scopo e la rimuoverà senza perdere
 *      informazioni, perché sono già tutte nella tabella varianti.
 */
import { randomUUID } from 'crypto';
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

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = $1
     ) as exists`,
    table,
  );
  return rows[0]?.exists ?? false;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const needsMigration = await columnExists(prisma, 'MenuItem', 'price');
    if (!needsMigration) {
      console.log('[auto-migrate-menu-variants] Nulla da migrare, database già aggiornato.');
      return;
    }

    console.log('[auto-migrate-menu-variants] Trovata "MenuItem.price": avvio la migrazione a varianti...');

    if (!(await tableExists(prisma, 'MenuItemVariant'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "MenuItemVariant" (
          "id" TEXT NOT NULL,
          "name" TEXT NOT NULL DEFAULT '',
          "price" DOUBLE PRECISION NOT NULL,
          "active" BOOLEAN NOT NULL DEFAULT true,
          "sortOrder" INTEGER NOT NULL DEFAULT 0,
          "loyverseVariantId" TEXT,
          "menuItemId" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX "MenuItemVariant_menuItemId_loyverseVariantId_key"
        ON "MenuItemVariant" ("menuItemId", "loyverseVariantId")
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "MenuItemVariant"
        ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey"
        FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
      `);
      console.log('[auto-migrate-menu-variants] Tabella "MenuItemVariant" creata.');
    }

    const items = await prisma.$queryRawUnsafe<{ id: string; price: number | null }[]>(
      'SELECT id, price FROM "MenuItem" WHERE price IS NOT NULL',
    );

    let migrated = 0;
    for (const item of items) {
      const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT COUNT(*)::bigint as count FROM "MenuItemVariant" WHERE "menuItemId" = $1',
        item.id,
      );
      if (Number(existing[0]?.count ?? 0) > 0) continue; // già migrata (script idempotente)

      await prisma.$executeRawUnsafe(
        `INSERT INTO "MenuItemVariant" (id, name, price, "sortOrder", active, "menuItemId", "createdAt", "updatedAt")
         VALUES ($1, '', $2, 0, true, $3, now(), now())`,
        randomUUID(),
        item.price,
        item.id,
      );
      migrated++;
    }

    console.log(
      `[auto-migrate-menu-variants] Migrate ${migrated} varianti su ${items.length} voci con prezzo. ` +
        'La colonna "price" verrà rimossa dal prossimo "prisma db push".',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[auto-migrate-menu-variants] Migrazione fallita:', err);
  process.exit(1);
});
