# BarManager

Piattaforma **multi-tenant** (web, PWA, containerizzata con Docker) per la gestione operativa di bar/ristoranti — un sotto-dominio per locale, pensata per il deploy su **Portainer** o **Coolify**:

- **Gestione locali** — un Super Admin crea i locali e il relativo account Admin; ogni locale è isolato e raggiungibile sul proprio sotto-dominio.
- **Presenze dipendenti** — timbratura via QR code, richieste assenza (ferie/permessi/malattia), report XLS/PDF.
- **Controlli HACCP** — rilevazione temperature frigoriferi, report stampabile su POS Epson, firma.
- **Inventario e ordini** — categorie/prodotti/fornitori, calcolo automatico quantità da ordinare, invio email e stampa checklist.
- **Menù online** — categorie, piatti con foto/prezzo/descrizione/allergeni, disponibilità oraria (pranzo/cena/tutto il giorno), visibilità e "temporaneamente non disponibile fino a", pagina pubblica senza login (es. da QR al tavolo).
- **Attività e scadenze** — pagamenti fornitori, visite mediche dipendenti, scadenza attestati, manutenzioni, anche ricorrenti (mensile/annuale).
- **Home amministrazione** — riepilogo giornaliero: richieste dipendenti in attesa (approvabili al volo), ordini da fare oggi (in base ai giorni impostati per fornitore), scadenze imminenti/scadute, altre notifiche.

Documento di progettazione completo (stack tecnologico, data model, moduli aggiuntivi proposti, deployment, roadmap): [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Stack

Backend NestJS + PostgreSQL (Prisma) + Redis · Frontend React + **MUI (Material Design)**, unica libreria icone `@mui/icons-material`, PWA installabile e predisposta per un wrapper Android via Capacitor. Nessun reverse proxy proprio: si appoggia a quello già presente su Portainer/Coolify. Dettagli completi nel documento di sviluppo.

## Avvio rapido (sviluppo)

```bash
cp .env.example .env   # valorizza le variabili (SMTP, ROOT_DOMAIN in produzione, ecc.)
docker compose up --build
```

- Frontend: http://localhost:5173 (chiama l'API in modo relativo, stesso origin)
- Backend API (diretta, comoda per test): http://localhost:3000/api

In locale, senza `ROOT_DOMAIN` configurato, il riconoscimento del locale per sotto-dominio è disattivato: login e menù pubblico funzionano comunque (il menù pubblico accetta `?venueSlug=demo` in query string per simulare un sotto-dominio).

Al primo avvio il backend applica lo schema Prisma al database (`prisma db push`). Per creare gli account iniziali:

```bash
docker compose exec backend npm run prisma:seed
```

Crea:
- **Super Admin** (gestisce i locali): `superadmin@barmanager.local` / `superadmin123`
- **Admin del locale demo** (slug `demo`): `admin@barmanager.local` / `admin123`

**Da cambiare subito** in produzione — vedi `backend/prisma/seed.ts`.

## Deploy su Portainer / Coolify

Vedi §9 del [documento di sviluppo](docs/DEVELOPMENT.md#9-nota-di-deployment) per il dettaglio: DNS wildcard `*.tuodominio.it`, configurazione del dominio su Coolify (TLS wildcard via DNS-01) o label Traefik su Portainer, e raggiungibilità delle stampanti Epson di rete.

## Struttura del repository

```
BarManager/
├── docs/DEVELOPMENT.md   # documento di sviluppo completo
├── docker-compose.yml
├── backend/               # API NestJS + Prisma
└── frontend/              # React + MUI (PWA)
```

## Stato del progetto

Multi-tenant (Super Admin + locali per sotto-dominio), autenticazione JWT + RBAC con isolamento dati per locale, e i moduli richiesti (presenze, HACCP, inventario/ordini, menù online, attività e scadenze) funzionanti end-to-end, con home dell'amministrazione che aggrega richieste/ordini/scadenze/notifiche del giorno. Alcune schermate di amministrazione secondarie (gestione dipendenti, categorie/prodotti, stampanti) sono disponibili via API ma non hanno ancora una UI dedicata — vedi §8 del documento di sviluppo per il dettaglio di cosa manca e la roadmap.
