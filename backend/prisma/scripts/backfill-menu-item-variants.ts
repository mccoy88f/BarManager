/**
 * Migrazione dati una tantum per il passaggio da "MenuItem.price" (un
 * prezzo unico per voce di menù) al modello a varianti ("MenuItemVariant",
 * più righe prezzo per voce). Necessaria SOLO per un database che ha già
 * dati con lo schema precedente — un'installazione nuova non serve.
 *
 * ATTENZIONE — ordine dei passaggi per non perdere i prezzi esistenti,
 * dato che questo progetto usa "prisma db push" (nessuna cronologia di
 * migrazioni): "db push" applicherebbe la rimozione della colonna
 * "price" e la creazione della tabella "MenuItemVariant" nello stesso
 * comando, quindi va eseguito questo script PRIMA di quel push finale,
 * mentre la colonna "price" esiste ancora nel database:
 *
 *   1. Fai un backup del database.
 *   2. Applica uno schema intermedio che aggiunge SOLO "MenuItemVariant"
 *      (senza ancora rimuovere "MenuItem.price") con "npx prisma db push".
 *   3. Esegui questo script: aggiunto sopra
 *        npx ts-node --transpile-only prisma/scripts/backfill-menu-item-variants.ts
 *   4. Solo ora applica lo schema finale (quello già nel repo, senza
 *      "MenuItem.price") con "npx prisma db push".
 *
 * Lo script usa SQL puro apposta: legge "price" direttamente dalla
 * tabella, senza passare dal modello Prisma generato (che a quel punto
 * potrebbe già non conoscere più quella colonna).
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const items = await prisma.$queryRawUnsafe<{ id: string; price: number | null }[]>(
      'SELECT id, price FROM "MenuItem" WHERE price IS NOT NULL',
    );

    console.log(`Trovate ${items.length} voci di menù con prezzo da migrare a variante.`);

    let migrated = 0;
    for (const item of items) {
      const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT COUNT(*)::bigint as count FROM "MenuItemVariant" WHERE "menuItemId" = $1',
        item.id,
      );
      if (Number(existing[0]?.count ?? 0) > 0) {
        continue; // già migrata (script rieseguibile in sicurezza)
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MenuItemVariant" (id, name, price, "sortOrder", active, "menuItemId", "createdAt", "updatedAt")
         VALUES ($1, '', $2, 0, true, $3, now(), now())`,
        randomUUID(),
        item.price,
        item.id,
      );
      migrated++;
    }

    console.log(`Migrate ${migrated} varianti (le restanti erano già state migrate in precedenza).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
