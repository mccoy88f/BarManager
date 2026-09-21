# BarManager

Piattaforma web (PWA, containerizzata con Docker) per la gestione operativa di bar/ristoranti:

- **Presenze dipendenti** — timbratura via QR code, richieste assenza (ferie/permessi/malattia), report XLS/PDF.
- **Controlli HACCP** — rilevazione temperature frigoriferi, report stampabile su POS Epson, firma.
- **Inventario e ordini** — categorie/prodotti/fornitori, calcolo automatico quantità da ordinare, invio email e stampa checklist.

Documento di progettazione completo (stack tecnologico, data model, moduli aggiuntivi proposti, roadmap): [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Stack

Backend NestJS + PostgreSQL (Prisma) + Redis · Frontend React + MUI (Material Design), PWA installabile e predisposta per un wrapper Android via Capacitor. Dettagli completi nel documento di sviluppo.

## Avvio rapido (sviluppo)

```bash
cp .env.example .env   # valorizza le variabili (in particolare SMTP se vuoi testare l'invio ordini)
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api
- Postgres: localhost:5432 · Redis: localhost:6379

Al primo avvio il backend applica lo schema Prisma al database (`prisma db push`). Per creare l'utente amministratore iniziale:

```bash
docker compose exec backend npm run prisma:seed
```

Crea un admin `admin@barmanager.local` / `admin123` (**da cambiare subito** in produzione) — vedi `backend/prisma/seed.ts`.

## Struttura del repository

```
BarManager/
├── docs/DEVELOPMENT.md   # documento di sviluppo completo
├── docker-compose.yml
├── backend/               # API NestJS + Prisma
└── frontend/              # React + MUI (PWA)
```

## Stato del progetto

Scaffold iniziale (Fase 0 della roadmap): autenticazione JWT + RBAC, data model completo, ed endpoint/pagine funzionanti end-to-end per i tre moduli richiesti (presenze, HACCP, inventario/ordini). Alcune schermate di amministrazione (gestione dipendenti, categorie/prodotti, stampanti) sono disponibili via API ma non hanno ancora una UI dedicata — vedi §8 del documento di sviluppo per il dettaglio di cosa manca e la roadmap.
