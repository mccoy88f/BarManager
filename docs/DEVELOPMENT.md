# BarManager — Documento di Sviluppo

> Piattaforma **multi-tenant** (un sotto-dominio per locale) per la gestione operativa di bar/ristoranti: presenze dipendenti, controlli HACCP, inventario e ordini fornitori, menù online. Web app installabile come PWA, progettata per essere convertita in app Android nativa (wrapper Capacitor) senza riscrivere il frontend. Pensata per il deploy su **Portainer** o **Coolify**, dietro il loro reverse proxy.

Versione: 0.2 — Multi-tenant + modulo Menù
Data: 2026-09-21

---

## 1. Obiettivi e principi guida

- **Multi-tenant fin dall'inizio**: un'unica installazione serve N locali, ciascuno isolato per dati (`venueId` su ogni tabella) e raggiungibile sul proprio sotto-dominio (`locale1.tuodominio.it`, `locale2.tuodominio.it`, ...). Un **Super Admin** (gestore della piattaforma) crea i locali e l'account amministratore di ciascuno; l'**Admin di locale** gestisce solo il proprio locale, senza vedere gli altri.
- **Multi-modulo**: ogni funzione (presenze, HACCP, inventario, menù, ...) è un modulo indipendente, visibile in base al ruolo dell'utente autenticato.
- **Mobile-first / PWA**: l'app dev'essere pienamente usabile da smartphone (i dipendenti timbrano da telefono inquadrando un QR, i clienti leggono il menù da QR al tavolo), installabile come PWA, e predisposta per un wrapper Android (Capacitor) senza modifiche architetturali.
- **Deploy su piattaforme container esistenti**: nessun reverse proxy "nostro" da gestire — l'app si appoggia al reverse proxy già presente su **Portainer** (tipicamente Nginx Proxy Manager/Traefik) o **Coolify** (Traefik integrato), che si occupano di TLS e instradamento per dominio/sotto-dominio.
- **Material Design coerente**: **MUI (Material UI) v5**, unica libreria UI e unica libreria icone (**Material Symbols/Icons** via `@mui/icons-material`) per l'intera app — niente mix di framework CSS/icone diversi, tema chiaro/scuro definito centralmente, componenti puliti e accessibili.
- **Sicurezza e tracciabilità**: dato che si maneggiano dati di presenza (rilevanti ai fini giuslavoristici) e controlli HACCP (rilevanti in caso di ispezione ASL), ogni inserimento/modifica è tracciato con audit log e timestamp immutabili lato server. L'isolamento fra locali (tenant) è imposto lato server ad ogni query, non solo lato UI.

---

## 2. Stack tecnologico

| Livello | Scelta | Motivazione |
|---|---|---|
| Backend | **Node.js 20 + NestJS + TypeScript** | struttura modulare "a moduli" che rispecchia 1:1 i moduli funzionali richiesti; DI, guard/decorator per i ruoli, ecosistema maturo |
| ORM / DB | **PostgreSQL 16 + Prisma ORM** | relazionale, transazionale, migrazioni versionate, tipizzazione end-to-end; ogni tabella "di dominio" ha `venueId` per l'isolamento multi-tenant |
| Cache / code | **Redis + BullMQ** | job asincroni: invio email ordini, generazione PDF/XLS, stampa su stampante di rete, senza bloccare le richieste HTTP |
| Autenticazione | **JWT (access + refresh token)**, hashing password con **argon2** | stateless, adatto a webapp + futura app mobile; il payload del JWT include `venueId` e `role` |
| Multi-tenancy | **Risoluzione per sotto-dominio** (middleware Nest) + isolamento dati per `venueId` a livello di servizio | requisito esplicito: un sotto-dominio per locale, super admin trasversale |
| Frontend | **React 18 + TypeScript + Vite** | build veloce, ottimo supporto PWA, un'unica SPA servita a tutti i sotto-domini (multi-tenant lato dati, non lato build) |
| UI Kit | **MUI (Material UI) v5** | Material Design "out of the box", theming chiaro/scuro, componenti pronti (tabelle, date/time picker, upload) |
| Icone | **@mui/icons-material (Material Symbols)** | libreria icone unica e pre-stabilita per tutta l'app, coerente con Material Design |
| Stato/dati client | **TanStack Query** (server state) + **Zustand** (stato UI/auth) | caching, invalidazione automatica, meno boilerplate di Redux |
| PWA | **vite-plugin-pwa** (service worker, manifest, installabilità) | requisito esplicito "che si può convertire in app Android" |
| App Android | **Capacitor** (fase 2) che incapsula la PWA | riusa il 100% del frontend, accesso a fotocamera nativa per QR, notifiche push native |
| PDF | **pdfkit** (server-side) | report presenze/HACCP/ordini stampabili e firmabili |
| XLS | **exceljs** (server-side) | export presenze/inventario |
| QR code | **qrcode** (generazione server-side) | badge/QR postazione per timbratura, QR tavolo per menù |
| Stampa POS | **node-thermal-printer** (ESC/POS su rete, driver Epson TM-* compatibile) | stampa scontrini/report su stampanti Epson di rete configurate dall'admin di locale |
| Email | **nodemailer** + SMTP configurabile per locale (o globale di piattaforma) | invio ordini fornitori |
| Upload immagini | **multer** (upload) + volume Docker persistente (evolvibile a S3/MinIO) | foto piatti del menù |
| Reverse proxy | **nessuno gestito da noi** — si usa quello di Portainer/Coolify (Traefik) davanti al container frontend | requisito esplicito: deploy su Portainer/Coolify |
| Containerizzazione | **Docker Compose**, pensato per essere importato come stack in Portainer o come progetto in Coolify | requisito esplicito |
| Test | **Vitest/Jest** (backend), **Playwright** (E2E), **React Testing Library** | qualità e non-regressione su moduli critici (calcolo ordini, presenze, isolamento tenant) |
| CI | GitHub Actions (lint, test, build immagini) | qualità continua |

Alternative scartate e perché: Django/Python (meno naturale per PWA+Capacitor condivisa col mobile), Flutter (richiederebbe due basi di codice), un framework CSS diverso da MUI per il menù pubblico (romperebbe la coerenza Material Design richiesta su tutta l'app).

---

## 3. Architettura multi-tenant

```
                DNS: *.tuodominio.it  →  IP del server (record wildcard)
                                │
                 ┌──────────────────────────────┐
                 │  Reverse proxy di Portainer/   │   (Traefik/NPM — non nostro,
                 │  Coolify — TLS wildcard         │    già presente sulla piattaforma)
                 └───────────────┬────────────────┘
                                   │  Host: locale1.tuodominio.it, locale2...
                          ┌────────▼─────────┐
                          │ Frontend (Nginx)   │  1 solo container per TUTTI i locali
                          │ React + MUI (PWA)  │  serve la stessa SPA a ogni sotto-dominio
                          │ proxy /api → API   │
                          └────────┬───────────┘
                                    │ stesso host (no CORS)
                          ┌─────────▼──────────┐
                          │   Backend API        │
                          │   NestJS              │
                          │ TenantMiddleware:      │
                          │ Host header → Venue    │
                          └───┬────────────┬──────┘
                              │            │
                  ┌───────────▼──┐   ┌─────▼──────┐
                  │ PostgreSQL    │   │  Redis      │
                  │ (righe con    │   │ (BullMQ)    │
                  │  venueId)     │   └──┬──────────┘
                  └───────────────┘       │
                          ┌────────────────┼─────────────────┐
                   ┌──────▼─────┐  ┌───────▼──────┐  ┌────────▼──────┐
                   │Worker email │  │Worker stampa  │  │Worker report  │
                   └─────────────┘  └───────────────┘  └───────────────┘
```

**Come funziona la risoluzione del tenant:**
1. Il reverse proxy (Portainer/Coolify) instrada **tutti** i sotto-domini `*.tuodominio.it` verso lo stesso container frontend (un solo router/regola, wildcard — non uno stack per locale).
2. Nginx nel container frontend serve la SPA e fa da proxy trasparente di `/api/*` verso il backend, cosicché frontend e API siano sempre sotto lo **stesso sotto-dominio** (niente CORS, niente configurazione per-locale lato client).
3. Un `TenantMiddleware` in NestJS legge l'header `Host` di ogni richiesta:
   - se il sotto-dominio corrisponde a un `Venue.slug` esistente → la richiesta è "nel contesto" di quel locale (usato per il menù pubblico, non autenticato);
   - se il sotto-dominio è quello riservato all'amministrazione (es. `admin.tuodominio.it`) → richiesta "host di piattaforma", riservata al Super Admin;
   - in sviluppo locale (senza sotto-domini) il controllo è disattivato.
4. Per le richieste **autenticate**, l'isolamento vero è dato dal `venueId` contenuto nel JWT (impostato al login) e usato da **ogni query** dei servizi: un Admin di locale non può in nessun caso leggere/scrivere dati di un altro `venueId`, indipendentemente dal sotto-dominio da cui arriva. Il login verifica comunque che l'utente appartenga al locale del sotto-dominio da cui sta accedendo (eccetto il Super Admin, che accede solo dall'host di amministrazione).
5. Le stampanti Epson POS di rete restano raggiungibili in **TCP diretto sulla porta 9100** dal container backend: per questo, se il deploy è su VPS cloud, serve una VPN/agente locale verso la LAN del locale (vedi §9).

---

## 4. Modelli di dominio (schema dati, riassunto)

Schema completo in `backend/prisma/schema.prisma`. Entità principali:

- **Venue** (locale) — `slug` univoco (sotto-dominio), nome, stato attivo/sospeso. Creato dal Super Admin.
- **User** — account di login: `SUPER_ADMIN` (nessun `venueId`, trasversale), `ADMIN`/`MANAGER`/`EMPLOYEE` (sempre legati a un `Venue`).
- **Role** — enum `SUPER_ADMIN | ADMIN | MANAGER | EMPLOYEE` (RBAC leggero; espandibile a permessi granulari in v2).
- **Employee** — anagrafica dipendente (nome, mansione, reparto, email, telefono, data assunzione).
- **QrToken** — token univoco per postazione fisica di timbratura.
- **AttendanceRecord** — timbrature (inizio/fine turno), `source` (QR/manuale/corretta), `correctedBy`, `note`.
- **LeaveRequest** — richieste assenza (ferie/permesso/malattia), giornata intera o parziale, stato (`PENDING/APPROVED/REJECTED`).
- **Fridge** — frigorifero/congelatore numerato, con range di temperatura accettabile.
- **TemperatureReading** — rilevazione temperatura, `outOfRange` calcolato, `correctiveAction` obbligatoria se fuori soglia.
- **HaccpReport** — istanza di report giornaliero generato/stampato/firmato.
- **Printer** — stampante POS di rete configurata dall'admin di locale (IP, porta, uso: HACCP/ordini).
- **ProductCategory / Product / Supplier / Order / OrderLine** — catalogo, scorte standard e flusso ordini (invariati rispetto alla v0.1, vedi §5.3).
- **MenuCategory** — categoria del menù online (es. "Antipasti", "Primi", "Vini"), con ordinamento.
- **MenuItem** — voce di menù: nome, descrizione, prezzo, foto, `allergens` (i 14 allergeni UE, enum), finestra di disponibilità oraria (`LUNCH`/`DINNER`/`ALL_DAY`), `visible` (mostra/nascondi dal menù pubblico), `unavailableUntil` (temporaneamente esaurito fino a una data/ora, calcolato automaticamente come non disponibile finché quel momento non è passato).
- **AuditLog** — traccia di ogni operazione sensibile (chi, cosa, quando, prima/dopo), sempre scoperta per `venueId`.
- **Notification** — notifiche in-app.

Diagramma ER semplificato:

```
                         ┌─────────────┐
                         │  SUPER_ADMIN │ (User, venueId = null)
                         └──────┬──────┘
                                │ crea
                         ┌──────▼──────┐
                         │    Venue     │ (slug = sotto-dominio)
                         └──────┬──────┘
        ┌───────────┬───────────┼───────────┬──────────────┐
        │            │            │            │              │
  User(ADMIN/   Fridge──*   ProductCategory  MenuCategory   Printer
  MANAGER/      TemperatureReading  ──*Product──1Supplier    ──*MenuItem
  EMPLOYEE)                              │
     │1                               Order──*OrderLine
  Employee1─*AttendanceRecord
           └─*LeaveRequest
```

---

## 5. Moduli funzionali

### 5.0 Gestione locali (Super Admin)

Modulo trasversale, non legato a un `venueId` (è il Super Admin che li amministra):

- **Elenco locali**: nome, sotto-dominio (`slug`), stato (attivo/sospeso), data creazione.
- **Nuovo locale**: il Super Admin inserisce nome e `slug` (validato: solo lettere minuscole/numeri/trattini, univoco) → crea il `Venue` e contestualmente il primo account **Admin di locale** (email + password provvisoria, da cambiare al primo accesso).
- **Sospensione locale**: disattiva l'accesso di tutti gli utenti di quel locale senza cancellare i dati (utile in caso di mancato pagamento/cessata attività).
- Il Super Admin **non** opera sui dati operativi di un locale (presenze, HACCP, ordini, menù): quello resta esclusivo dell'Admin/Manager del locale. Un accesso di supporto da parte del Super Admin ai dati di un locale, se mai servisse, va tracciato esplicitamente (fuori scope v1).

### 5.1 Presenze dipendenti

**Flusso timbratura:**
1. L'admin di locale genera/stampa un QR per ogni postazione di timbratura (es. ingresso). Il QR incapsula un URL tipo `https://locale1.tuodominio.it/clock/{qrToken}`.
2. Il dipendente inquadra il QR con la fotocamera del telefono → apre la PWA del **proprio** locale.
3. Se non è loggato, vede la pagina di login; se è già loggato, va dritto alla pagina di timbratura con due grandi pulsanti Material **"Inizio turno" / "Fine turno"**, stato corrente evidenziato.
4. Il backend registra `AttendanceRecord` con timestamp server-side (mai il timestamp del client), il `qrToken` usato.
5. Anti-doppio-click: se l'ultimo evento è "inizio" senza "fine", il pulsante mostra solo "Fine turno" e viceversa.

**Amministrazione:** vista tabellare, correzione manuale tracciata in audit log, export XLS/PDF per periodo.

**Richieste assenza (dipendente):** form tipo/giorno intero-parziale/note; **approvazione (admin/responsabile):** coda pendenti, approva/rifiuta con nota.

### 5.2 Controlli HACCP

- L'admin censisce i frigoriferi/congelatori (nome/numero, ubicazione, range temperatura accettabile).
- Inserimento giornaliero temperature da form mobile; valore fuori soglia → evidenza rossa + **azione correttiva obbligatoria** + notifica al responsabile.
- Report giornaliero: **stampa su stampante POS Epson di rete** con spazio firma manuale, oppure **firma digitale a video** (pad firma → immagine nel PDF).
- Storico consultabile e riesportabile in qualsiasi momento.

### 5.3 Inventario e ordini

- Categorie e prodotti/formati con `standardQty` (scorta obiettivo), fornitore predefinito.
- **Nuovo ordine**: scelta fornitore → giacenza per prodotto → calcolo automatico `quantità da ordinare = max(0, standardQty − giacenza)`, modificabile.
- Alla conferma: **email** al fornitore (CC automatico ai responsabili di reparto) + **stampa POS** della checklist per il controllo scarico merce. Storico ordini per affinare la `standardQty` nel tempo.

### 5.4 Menù online

Gestione del menù del locale, consultabile pubblicamente (es. da QR al tavolo) senza bisogno di login.

**Amministrazione (Admin/Manager):**
- **Categorie** menù create liberamente (es. Antipasti, Primi, Secondi, Dolci, Vini, Birre...), con ordinamento drag&drop.
- Per ogni **voce di menù**: nome, foto (upload, con anteprima e ritaglio), prezzo, descrizione, **allergeni** selezionabili dall'elenco ufficiale dei 14 allergeni UE (reg. 1169/2011: glutine, crostacei, uova, pesce, arachidi, soia, latte, frutta a guscio, sedano, senape, sesamo, solfiti, lupini, molluschi) mostrati come icone/chip.
- **Disponibilità oraria**: ogni voce può essere marcata `Solo pranzo`, `Solo cena` o `Tutto il giorno`; il menù pubblico mostra automaticamente solo le voci pertinenti all'orario corrente (calcolato lato server in base al fuso orario del locale, con le fasce pranzo/cena configurabili dall'admin).
- **Visibilità**: interruttore rapido "mostra/nascondi dal menù" per togliere temporaneamente una voce senza cancellarla.
- **Temporaneamente non disponibile fino a**: selezione data/ora — la voce resta visibile nel menù ma marcata "non disponibile" (es. esaurita) fino al momento indicato, dopo il quale torna automaticamente ordinabile senza bisogno di un'azione manuale.

**Menù pubblico (nessun login):**
- Pagina raggiungibile su `https://locale1.tuodominio.it/menu` (anche da QR al tavolo), risolta automaticamente in base al sotto-dominio.
- Voci raggruppate per categoria, filtrate per orario corrente e visibilità; badge allergeni; badge "non disponibile" per le voci temporaneamente esaurite.
- Nessun dato sensibile esposto: solo le informazioni pubbliche della voce di menù.

---

## 6. Altri moduli utili individuati (proposte)

1. **Gestione turni/pianificazione (shift planning)** — collegata alle presenze: confronto pianificato vs timbrato.
2. **Ruoli e permessi granulari** — oltre a Admin/Manager/Employee, "responsabile" di una o più categorie/reparti.
3. **Notifiche** (push via PWA + email): ferie pendenti, temperature fuori soglia, scorte sotto soglia, ordine confermato.
4. **Scadenzario documenti** — HACCP, contratti, assicurazioni, manutenzioni obbligatorie: alert N giorni prima.
5. **Manutenzioni attrezzature** — log interventi tecnici (utile anche a giustificare uno sbalzo HACCP).
6. **Gestione fornitori estesa** — listini/prezzi storici, tempi di consegna medi.
7. **Dashboard analytics** — costo personale, andamento ordini/spesa, non conformità HACCP, assenteismo; per il Super Admin, KPI aggregati su tutti i locali.
8. **Audit log consultabile** — vista admin "chi ha fatto cosa".
9. **Backup automatico** — dump schedulato del DB su storage esterno S3-compatibile.
10. **Multi-lingua UI** — i18n (react-i18next) per menù pubblico e app dipendenti (molti non madrelingua italiani); il menù pubblico multi-lingua è particolarmente utile per clientela turistica.
11. **Modalità offline-first per HACCP/presenze** — service worker con coda locale (IndexedDB).
12. **QR per tavolo con ordinazione** — evoluzione naturale del menù online: dal semplice "consulta" a un vero e proprio invio ordine al tavolo (fuori scope v1, ma il modello `MenuItem` è già compatibile).
13. **Integrazione futura con cassa/POS di vendita** — collegamento a incassi/consumi reali per suggerire automaticamente la `standardQty`.

Nel roadmap (§8) questi sono marcati come v1 (fondamentali, bassa complessità aggiuntiva) o v2/v3 (da valutare con l'utente).

---

## 7. Sicurezza, conformità e isolamento multi-tenant

- Password hashate con **argon2id**; JWT access token a vita breve (15 min) + refresh token.
- **RBAC** a livello di endpoint (guard NestJS) e di UI. Il ruolo `SUPER_ADMIN` non ha accesso agli endpoint operativi dei locali (presenze/HACCP/inventario/menù), solo a quelli di gestione `Venue`.
- **Isolamento tenant**: ogni servizio filtra sempre per `venueId` preso dal JWT, mai da input del client; un tentativo di accedere/modificare una risorsa di un altro `venueId` restituisce 404 (non 403, per non rivelare l'esistenza della risorsa).
- Il login verifica la coerenza fra sotto-dominio da cui si accede e `venueId` dell'utente (eccetto Super Admin, riservato all'host di amministrazione).
- Tutte le scritture su presenze/HACCP/ordini passano da **audit log** immutabile (append-only), scoperto per `venueId`.
- Rate limiting su login e sugli endpoint pubblici (menù, timbratura via QR).
- I QR di timbratura sono legati a un `token` opaco lato server, rigenerabile se compromesso.
- Validazione input con `class-validator` su ogni DTO backend.
- HTTPS obbligatorio in produzione, gestito dal reverse proxy di Portainer/Coolify (certificato wildcard `*.tuodominio.it`).
- Dati HACCP e presenze conservati per il periodo minimo di legge, con export scaricabile in ogni momento.

---

## 8. Roadmap di sviluppo

**Fase 0 — Fondamenta (già scaffoldato)**
- Docker Compose, schema dati Prisma, autenticazione JWT + RBAC, shell frontend Material con routing/tema/PWA, moduli Presenze/HACCP/Inventario end-to-end.

**Fase 0-bis — Multi-tenant + Menù (questo aggiornamento)**
- Ruolo `SUPER_ADMIN` e modulo gestione locali (creazione locale + primo admin).
- `TenantMiddleware` per risoluzione sotto-dominio, isolamento dati per `venueId` verificato su ogni servizio.
- Modulo Menù online completo (categorie, voci, allergeni, disponibilità oraria, visibilità, "non disponibile fino a") + pagina pubblica senza login.
- Adeguamento Docker Compose/Nginx per deploy dietro il reverse proxy di Portainer/Coolify (nessun Traefik proprio, proxy `/api` same-origin).

**Fase 1 — Rifinitura MVP**
- UI di amministrazione mancanti (dipendenti, categorie/prodotti/fornitori, stampanti) — oggi disponibili via API.
- Notifiche essenziali (email) per approvazioni e temperature fuori soglia.

**Fase 2 — Moduli complementari**
- Dashboard analytics (anche aggregata multi-locale per il Super Admin), scadenzario documenti, manutenzioni, audit log UI, gestione turni base.
- App Android via Capacitor.
- Offline-first per HACCP/presenze.

**Fase 3 — Estensioni**
- Permessi granulari, multi-lingua (incluso menù pubblico), backup gestito, QR tavolo con ordinazione, integrazione cassa/vendite.

---

## 9. Nota di deployment

### 9.1 Portainer / Coolify e sotto-domini

- **DNS**: creare un record **wildcard** `*.tuodominio.it → IP del server` (oltre, se serve, ad `admin.tuodominio.it` se si preferisce un sotto-dominio dedicato invece della wildcard per l'host di amministrazione).
- **Coolify**: nella configurazione del dominio dell'applicazione si può indicare direttamente `*.tuodominio.it`; Coolify genera automaticamente le regole Traefik e il certificato wildcard (richiede credenziali del provider DNS per la validazione **DNS-01**, obbligatoria per i certificati wildcard).
- **Portainer**: si importa `docker-compose.yml` come stack; se davanti c'è Traefik o Nginx Proxy Manager, va aggiunta la regola di routing per `*.tuodominio.it` verso il servizio `frontend` (porta 80) — un esempio di label Traefik è incluso, commentato, in `docker-compose.yml`.
- L'app **non** include un proprio container reverse proxy: il traffico arriva già in chiaro (HTTP) dal proxy della piattaforma al container `frontend`, che fa da unico punto d'ingresso (proxando `/api` al backend).

### 9.2 Stampanti di rete

Le stampanti Epson POS via Ethernet devono essere raggiungibili dal container backend sulla porta **9100/TCP**:

- **Locale con server on-premise** (mini-PC nel bar che fa da host Docker): nessun problema, stessa LAN — configurazione consigliata.
- **Deploy cloud** (VPS con Portainer/Coolify): serve una VPN/agente locale (es. WireGuard/Tailscale) che esponga le stampanti della LAN al backend cloud.

---

## 10. Decisioni ancora aperte (da confermare con l'utente)

- Dominio principale da usare per la wildcard (es. `tuodominio.it`) e provider DNS (necessario per il certificato wildcard via DNS-01 su Coolify).
- Host riservato al Super Admin: sotto-dominio dedicato (`admin.tuodominio.it`) o dominio apice.
- Storage delle foto del menù: volume Docker locale (default attuale, più semplice) oppure S3/MinIO fin da subito, se si prevede un deploy multi-host senza volumi condivisi.
- Dove verrà ospitato in produzione: server on-premise vs VPS cloud (impatta la strategia stampanti, vedi §9.2).
- Provider SMTP: globale di piattaforma (un solo mittente per tutti i locali) oppure configurabile per singolo locale.
- Contratto orario dipendenti (per calcolo straordinari/ferie maturate): regole CCNL da applicare.

---

## 11. Struttura repository

```
BarManager/
├── docs/DEVELOPMENT.md
├── docker-compose.yml
├── .env.example
├── backend/                    (NestJS API)
│   ├── prisma/schema.prisma
│   └── src/
│       ├── common/tenant/      (TenantMiddleware, resolve venue da Host)
│       ├── venues/             (Super Admin: gestione locali)
│       ├── auth/
│       ├── users/
│       ├── attendance/         (presenze + leave-requests)
│       ├── haccp/
│       ├── inventory/
│       ├── menu/               (menù online: categorie, voci, upload foto)
│       ├── printing/            (client ESC/POS)
│       └── reports/             (PDF/XLS)
└── frontend/                   (React + MUI PWA)
    └── src/
        ├── pages/super-admin/
        ├── pages/attendance/
        ├── pages/haccp/
        ├── pages/inventory/
        └── pages/menu/          (admin + pagina pubblica)
```
