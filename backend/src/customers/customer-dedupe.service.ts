import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Il più vecchio/il più recente tra le date del gruppo, ignorando i null (nessuna prenotazione ancora registrata). */
function earliest(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
}
function latest(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => d !== null);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
}

/**
 * Pulizia dei clienti duplicati per email nello stesso locale (§5.8 di
 * DEVELOPMENT.md): righe create prima che la normalizzazione (trim +
 * lowercase) dell'email fosse applicata su ogni percorso di scrittura
 * (CRUD manuale, import xlsx, upsert da prenotazione) possono differire
 * solo per maiuscole/minuscole — e il vincolo `@@unique([venueId, email])`
 * non le rileva, perché il confronto a livello di database è letterale
 * (case-sensitive). Eseguita al boot dell'app (`onModuleInit`, quindi a
 * ogni deploy): dopo il primo run che trova ed elimina i doppioni non
 * resta più nulla da unire, quindi lasciarla attiva ad ogni avvio non ha
 * effetti né costi ulteriori — è pensata per essere permanente, non un
 * one-off da rimuovere dopo il primo deploy.
 */
@Injectable()
export class CustomerDedupeService implements OnModuleInit {
  private readonly logger = new Logger(CustomerDedupeService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.mergeDuplicates();
    } catch (err) {
      // Non deve mai bloccare l'avvio dell'app: un problema qui è comunque
      // meno grave di un intero locale che non riesce ad accedere al sistema.
      this.logger.error(`Deduplica clienti fallita: ${(err as Error).message}`);
    }
  }

  /**
   * Raggruppa per `venueId` + email normalizzata (mai tra locali diversi:
   * lo stesso cliente in due locali distinti resta due clienti distinti).
   * Per ogni gruppo con più di una riga: tiene come canonica la più
   * vecchia (`createdAt` crescente — "il primo trovato"), le somma
   * `reservationsCount`, prende la `firstReservationAt` più vecchia e la
   * `lastReservationAt` più recente fra tutte le righe del gruppo, il
   * `marketingConsent` della riga aggiornata più di recente (il consenso
   * più verosimilmente ancora valido) e un `privacyToken` se ne esiste
   * uno in una delle righe (per non invalidare un link "gestisci i tuoi
   * dati" già mandato), poi elimina le altre righe del gruppo.
   */
  async mergeDuplicates() {
    const customers = await this.prisma.customer.findMany({ orderBy: { createdAt: 'asc' } });

    const groups = new Map<string, Customer[]>();
    for (const customer of customers) {
      const key = `${customer.venueId}:${normalizeEmail(customer.email)}`;
      const group = groups.get(key);
      if (group) group.push(customer);
      else groups.set(key, [customer]);
    }

    let mergedGroups = 0;
    let removedRows = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [canonical, ...duplicates] = group; // già ordinato per createdAt asc: il primo è il più vecchio

      const reservationsCount = group.reduce((sum, c) => sum + c.reservationsCount, 0);
      const firstReservationAt = earliest(group.map((c) => c.firstReservationAt));
      const lastReservationAt = latest(group.map((c) => c.lastReservationAt));
      const mostRecentlyUpdated = group.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
      const privacyToken = canonical.privacyToken ?? group.find((c) => c.privacyToken)?.privacyToken ?? null;

      // Prima elimina i doppioni, poi aggiorna la canonica: se si
      // trasferisce un `privacyToken` da un doppione (unico a livello
      // globale), farlo nell'ordine opposto violerebbe per un istante il
      // vincolo, con entrambe le righe a tenere lo stesso valore prima
      // che la delete abbia effetto.
      await this.prisma.$transaction([
        this.prisma.customer.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } }),
        this.prisma.customer.update({
          where: { id: canonical.id },
          data: {
            email: normalizeEmail(canonical.email),
            reservationsCount,
            firstReservationAt,
            lastReservationAt,
            marketingConsent: mostRecentlyUpdated.marketingConsent,
            privacyToken,
          },
        }),
      ]);

      mergedGroups += 1;
      removedRows += duplicates.length;
    }

    if (mergedGroups > 0) {
      this.logger.log(
        `Uniti ${mergedGroups} gruppi di clienti duplicati per email (${removedRows} righe rimosse).`,
      );
    }
  }
}
