# BarManager — Documento di Sviluppo

> Piattaforma web (PWA, containerizzata) per la gestione operativa di bar/ristoranti: presenze dipendenti, controlli HACCP, inventario e ordini fornitori. Progettata per essere convertita in app Android nativa (wrapper Capacitor) senza riscrivere il frontend.

Versione: 0.1 — Bozza iniziale
Data: 2026-09-21

---

## 1. Obiettivi e principi guida

- **Multi-modulo**: ogni funzione (presenze, HACCP, inventario, ...) è un modulo indipendente, visibile in base al ruolo dell'utente autenticato.
- **Mobile-first / PWA**: l'app dev'essere pienamente usabile da smartphone (i dipendenti timbrano da telefono inquadrando un QR), installabile come PWA, e predisposta per un wrapper Android (Capacitor) senza modifiche architetturali.
- **Multi-tenant "locale singolo" in v1**: si parte con un solo locale/azienda per installazione; il data model è comunque preparato per multi-locale (campo `venueId` ovunque) per non dover fare migrazioni dolorose in futuro.
- **Deploy semplice**: tutto containerizzato con Docker Compose, un comando per avviare l'intero stack in locale o su un piccolo VPS.
- **Material Design**: interfaccia coerente con le linee guida Material (MUI/Material 3), tema chiaro/scuro, componenti accessibili.
- **Sicurezza e tracciabilità**: dato che si maneggiano dati di presenza (rilevanti ai fini giuslavoristici) e controlli HACCP (rilevanti in caso di ispezione ASL), ogni inserimento/modifica è tracciato con audit log e timestamp immutabili lato server.

---

## 2. Stack tecnologico

| Livello | Scelta | Motivazione |
|---|---|---|
| Backend | **Node.js 20 + NestJS + TypeScript** | struttura modulare "a moduli" che rispecchia 1:1 i moduli funzionali richiesti; DI, guard/decorator per i ruoli, ecosistema maturo |
| ORM / DB | **PostgreSQL 16 + Prisma ORM** | relazionale, transazionale (importante per calcolo ordini e presenze), migrazioni versionate, tipizzazione end-to-end |
| Cache / code | **Redis + BullMQ** | job asincroni: invio email ordini, generazione PDF/XLS, stampa su stampante di rete, senza bloccare le richieste HTTP |
| Autenticazione | **JWT (access + refresh token)**, hashing password con **argon2** | stateless, adatto a webapp + futura app mobile |
| Frontend | **React 18 + TypeScript + Vite** | build veloce, ottimo supporto PWA |
| UI Kit | **MUI (Material UI) v5 / Material 3** | Material Design "out of the box", theming chiaro/scuro, componenti pronti (tabelle, date picker, ecc.) |
| Stato/dati client | **TanStack Query** (server state) + **Zustand** (stato UI/auth) | caching, invalidazione automatica, meno boilerplate di Redux |
| PWA | **vite-plugin-pwa** (service worker, manifest, installabilità) | requisito esplicito "che si può convertire in app Android" |
| App Android | **Capacitor** (fase 2) che incapsula la PWA | riusa il 100% del frontend, accesso a fotocamera nativa per QR, notifiche push native |
| PDF | **pdfkit** (server-side) | report presenze/HACCP/ordini stampabili e firmabili |
| XLS | **exceljs** (server-side) | export presenze/inventario |
| QR code | **qrcode** (generazione server-side) | badge/QR postazione per timbratura |
| Stampa POS | **node-thermal-printer** (ESC/POS su rete, driver Epson TM-* compatibile) | stampa scontrini/report su stampanti Epson di rete configurate dall'admin |
| Email | **nodemailer** + SMTP configurabile da admin (o provider tipo SMTP di Gmail/Aruba/etc.) | invio ordini fornitori |
| Reverse proxy | **Traefik** (o Nginx) con TLS via Let's Encrypt | esposizione sicura in produzione |
| Containerizzazione | **Docker Compose** (dev) — immagini pronte per **Docker Swarm/Kubernetes** in futuro | requisito esplicito |
| Test | **Vitest/Jest** (backend), **Playwright** (E2E), **React Testing Library** | qualità e non-regressione su moduli critici (calcolo ordini, presenze) |
| CI | GitHub Actions (lint, test, build immagini) | qualità continua |

Alternative scartate e perché: Django/Python (meno naturale per PWA+Capacitor condivisa col mobile, ecosistema stampa ESC/POS meno maturo), Flutter (richiederebbe due basi di codice se si vuole anche la webapp "vera" lato browser, mentre PWA+Capacitor ne richiede una sola).

---

## 3. Architettura

```
                         ┌────────────────────┐
                         │   Reverse Proxy      │  (Traefik/Nginx, TLS)
                         └──────────┬──────────┘
                    ┌────────────────┼────────────────┐
                    │                                   │
            ┌───────▼────────┐                 ┌────────▼────────┐
            │  Frontend (PWA) │                 │   Backend API    │
            │  React+MUI      │  REST/JSON+JWT  │   NestJS         │
            │  Nginx (static) │◄───────────────►│                  │
            └─────────────────┘                 └───┬────────┬────┘
                                                      │        │
                                          ┌───────────▼──┐  ┌──▼────────┐
                                          │ PostgreSQL    │  │  Redis     │
                                          │ (Prisma)      │  │ (BullMQ)   │
                                          └───────────────┘  └──┬─────────┘
                                                                  │
                                          ┌───────────────────────┼─────────────────┐
                                          │                       │                  │
                                   ┌──────▼─────┐         ┌───────▼──────┐   ┌───────▼──────┐
                                   │ Worker email│         │Worker stampa  │   │Worker report │
                                   │ (nodemailer)│         │(ESC/POS TCP)  │   │(PDF/XLS)     │
                                   └─────────────┘         └───────────────┘   └──────────────┘
```

- Il frontend non parla mai direttamente con stampanti/SMTP: passa dal backend, che mette in coda i job (disaccoppiamento, retry automatici se la stampante è offline o l'SMTP è irraggiungibile).
- Le stampanti Epson POS di rete vengono raggiunte in **TCP diretto sulla porta 9100 (RAW/ESC-POS)** dal container backend/worker: per questo backend e stampanti devono stare sulla stessa rete (LAN del locale) oppure dietro un piccolo agente locale (vedi §9 "Nota di deployment").

---

## 4. Modelli di dominio (schema dati, riassunto)

Schema completo in `backend/prisma/schema.prisma`. Entità principali:

- **Venue** (locale/azienda) — predisposizione multi-tenant.
- **User** — account di login: admin, responsabile di reparto, dipendente. Collegato opzionalmente a `Employee`.
- **Role / Permission** — RBAC leggero (enum di ruoli in v1: `ADMIN`, `MANAGER`, `EMPLOYEE`; espandibile a permessi granulari in v2).
- **Employee** — anagrafica dipendente (nome, mansione, reparto, email, telefono, data assunzione).
- **QrToken** — token univoco associato a una postazione fisica di timbratura (stampato/esposto come QR), con eventuale scadenza/rotazione.
- **AttendanceRecord** — timbrature (inizio/fine turno), con `source` (QR/manuale/corretta da admin), `correctedBy`, `note`.
- **LeaveRequest** — richieste assenza (ferie/permesso/malattia), `partialDay` + `startTime/endTime` per permessi a ore, stato (`PENDING/APPROVED/REJECTED`), `reviewedBy`.
- **Fridge** — frigorifero/congelatore numerato, con range di temperatura accettabile (min/max) configurato dall'admin.
- **TemperatureReading** — rilevazione giornaliera per frigo, valore, timestamp, utente che l'ha inserita, flag `outOfRange` calcolato automaticamente, eventuale `correctiveAction` (azione correttiva HACCP se fuori soglia — requisito normativo).
- **HaccpReport** — istanza di report giornaliero generato/stampato, con firma (immagine firma digitale o testo + timestamp) di chi firma.
- **Printer** — stampante POS configurata dall'admin (nome, IP, porta, tipo, reparto/uso: HACCP, ordini, ecc.).
- **ProductCategory** — categoria prodotto creata dall'admin (es. "Bibite", "Liquori", "Materie prime cucina").
- **Product** — prodotto/formato con `standardQty` (scorta standard/target), unità di misura, fornitore preferito, soglia di riordino.
- **Supplier** — fornitore (nome, email, email reparti/responsabili aggiuntivi, telefono).
- **Order** — ordine generato: stato (`DRAFT/SENT/CONFIRMED/CLOSED`), fornitore, data, righe.
- **OrderLine** — riga ordine: prodotto, giacenza rilevata, quantità da ordinare (calcolata: `standardQty - giacenza`, mai negativa), quantità effettivamente ordinata (modificabile manualmente prima dell'invio).
- **AuditLog** — traccia di ogni operazione sensibile (chi, cosa, quando, valori prima/dopo) su presenze, HACCP, ordini.
- **Notification** — notifiche in-app (approvazioni richieste, temperature fuori soglia, scorte sotto soglia).

Diagramma ER semplificato:

```
Venue 1─* User 1─0..1 Employee 1─* AttendanceRecord
                              └─* LeaveRequest
Venue 1─* Fridge 1─* TemperatureReading
Venue 1─* Printer
Venue 1─* ProductCategory 1─* Product *─1 Supplier
Venue 1─* Order 1─* OrderLine *─1 Product
```

---

## 5. Moduli funzionali

### 5.1 Presenze dipendenti

**Flusso timbratura:**
1. L'admin genera/stampa un QR per ogni postazione di timbratura (es. ingresso). Il QR incapsula un URL tipo `https://app.barmanager.it/clock/{qrToken}`.
2. Il dipendente inquadra il QR con la fotocamera del telefono → apre la PWA.
3. Se non è loggato, vede la pagina di login; se è già loggato (sessione salvata), va dritto alla pagina di timbratura con due grandi pulsanti Material **"Inizio turno" / "Fine turno"**, stato corrente evidenziato.
4. Il backend registra `AttendanceRecord` con timestamp server-side (mai il timestamp del client, per evitare manomissioni), geolocalizzazione facoltativa (solo per audit, non bloccante), e il `qrToken` usato (per sapere da quale postazione).
5. Anti-doppio-click / doppia timbratura: se l'ultimo evento è "inizio" senza "fine", il pulsante mostra solo "Fine turno" e viceversa.

**Amministrazione:**
- Vista tabellare presenze per dipendente/periodo, con possibilità di **correggere manualmente** un orario (tracciato in audit log con motivo obbligatorio).
- Calcolo automatico ore lavorate/giorno/settimana/mese, straordinari (oltre soglia configurabile).
- **Export XLS/PDF** per periodo (mensile per cedolino, o range custom), pronto per il consulente del lavoro.

**Richieste assenza (dipendente):**
- Form: tipo (ferie/permesso/malattia), giornata intera o parziale (con orario), note, allegato opzionale (es. certificato medico).
- Notifica al/i responsabile/i.

**Approvazione (admin/responsabile):**
- Coda richieste pendenti, approvazione/rifiuto con nota, effetto automatico sul calendario presenze (giorno segnato come assenza giustificata, non conteggiato come mancata timbratura).

### 5.2 Controlli HACCP

- L'admin censisce i frigoriferi/congelatori (nome/numero, ubicazione, range temperatura accettabile).
- Ogni giorno, il personale incaricato inserisce manualmente la temperatura rilevata per ciascun frigo da un form ottimizzato mobile (lista frigo con input numerico grande, uno sotto l'altro).
- Se un valore è **fuori soglia**, l'app lo evidenzia in rosso e **obbliga** l'inserimento di un'azione correttiva testuale (requisito reale HACCP: non basta registrare l'anomalia, va registrata la correzione) + notifica push/email al responsabile.
- Fine giornata (o su richiesta): generazione del **report giornaliero** (tabella frigo × temperatura × ora rilevazione × operatore) con:
  - **Stampa su stampante POS Epson di rete** (formato scontrino, ESC/POS), con spazio per firma manuale a penna, oppure
  - **Firma digitale a video** (pad firma touch, salvata come immagine nel PDF) per chi vuole restare 100% digitale.
- Storico consultabile e riesportabile in qualsiasi momento (obbligo di conservazione documentale HACCP, tipicamente alcuni anni).

### 5.3 Inventario e ordini

- L'admin crea **categorie** (es. Bibite, Birre, Liquori, Materie prime) e per ciascuna i **prodotti/formati** con: unità di misura, **quantità standard** (scorta obiettivo), soglia minima di riordino, fornitore predefinito.
- **Nuovo ordine**: l'utente sceglie un fornitore → il sistema mostra tutti i prodotti di quel fornitore raggruppati per categoria → per ciascuno si inserisce la **giacenza attuale** (quanto resta) → il sistema calcola automaticamente `quantità da ordinare = max(0, standardQty − giacenza)`, modificabile manualmente riga per riga prima di confermare.
- Alla conferma:
  - Viene creata un'**email** all'indirizzo del fornitore con l'elenco ordinato (quantità, prodotto, eventuale codice fornitore), **in CC automatico ai responsabili di reparto** configurati (dipendenti marcati come "responsabile" per quella categoria/reparto).
  - Viene **stampata su stampante POS** la lista con le quantità ordinate, da usare come checklist al momento dello scarico merce (spuntando manualmente ciò che arriva, per rilevare discrepanze).
  - L'ordine resta storicizzato con stato (inviato/confermato/chiuso) e può essere richiamato per vedere l'andamento storico dei consumi per prodotto (utile per affinare la `standardQty` nel tempo).

---

## 6. Altri moduli utili individuati (proposte)

Analizzando il dominio "gestione bar/ristorante" emergono necessità collegate che conviene prevedere fin da subito nel modello (anche se implementate in fasi successive):

1. **Gestione turni/pianificazione (shift planning)** — collegata alle presenze: l'admin pianifica i turni futuri, il sistema confronta pianificato vs timbrato ed evidenzia scostamenti.
2. **Ruoli e permessi granulari** — oltre a Admin/Manager/Employee, poter marcare un dipendente come "responsabile" di una o più categorie prodotto (per CC ordini) e/o di un reparto (per approvazione ferie del proprio team).
3. **Notifiche** (push via PWA + email): richieste ferie pendenti, temperature HACCP fuori soglia, scorte sotto la soglia minima, ordine confermato/in ritardo.
4. **Scadenzario documenti** — HACCP (manuale, certificati corsi alimentaristi, DVR), contratti dipendenti, assicurazioni, manutenzioni obbligatorie (es. controllo estintori, manutenzione celle frigo): alert automatico N giorni prima della scadenza.
5. **Manutenzioni attrezzature** — log manutenzioni/interventi tecnici su frigoriferi e altre attrezzature (utile anche per giustificare uno sbalzo di temperatura HACCP: "frigo X in manutenzione il giorno Y").
6. **Gestione fornitori estesa** — anagrafica completa, listini/prezzi per prodotto nel tempo (storico prezzi per confronto), tempi di consegna medi.
7. **Dashboard analytics** — KPI a colpo d'occhio: costo del personale (ore × costo orario) nel periodo, andamento ordini/spesa per categoria, non conformità HACCP nel tempo, tasso di assenteismo.
8. **Multi-locale** — per chi gestisce più punti vendita: switch locale, dati e permessi isolati per `venueId` (già previsto nel data model), report aggregati multi-locale per l'owner.
9. **Audit log consultabile** — vista admin di "chi ha fatto cosa" (utile in caso di contestazioni su presenze o HACCP).
10. **Backup automatico** — dump schedulato del DB (job notturno) su storage esterno (S3-compatibile), fondamentale trattandosi di dati con valore legale/fiscale.
11. **Multi-lingua UI** — molti dipendenti di sala/cucina non sono madrelingua italiani; i18n predisposto fin dal frontend (react-i18next) anche se in v1 si parte solo con IT.
12. **Modalità offline-first per HACCP/presenze** — nei retro-cucina spesso il wifi è debole: service worker con coda locale (IndexedDB) che sincronizza le timbrature/temperature appena torna la connessione.
13. **Integrazione futura con cassa/POS di vendita** — non richiesta ora, ma il modello "Product" è tenuto volutamente compatibile con un futuro collegamento a incassi/consumi reali per suggerire automaticamente la `standardQty`.

Nel roadmap (§8) questi sono marcati come v1 (fondamentali, bassa complessità aggiuntiva) o v2/v3 (da valutare con l'utente).

---

## 7. Sicurezza e conformità

- Password hashate con **argon2id**; JWT access token a vita breve (15 min) + refresh token httpOnly cookie.
- **RBAC** a livello di endpoint (guard NestJS) e a livello di UI (route protette + rendering condizionale dei moduli).
- Tutte le scritture su presenze/HACCP/ordini passano da **audit log** immutabile (append-only).
- Rate limiting sugli endpoint di login e sull'endpoint pubblico di timbratura via QR.
- I QR di timbratura sono legati a un `token` opaco lato server (non l'ID del dipendente), rigenerabile dall'admin se compromesso.
- Validazione input con `class-validator` su ogni DTO backend (mai fidarsi del client).
- HTTPS obbligatorio in produzione (reverse proxy con TLS).
- Dati HACCP e presenze conservati per il periodo minimo di legge (configurabile), con export scaricabile in ogni momento per l'ispettore/consulente.

---

## 8. Roadmap di sviluppo

**Fase 0 — Fondamenta (questo commit)**
- Scaffolding repo, Docker Compose, schema dati Prisma completo, autenticazione JWT + RBAC, shell frontend Material con routing/tema/PWA, primo modulo end-to-end (Presenze: QR + timbratura + admin) come pattern di riferimento per gli altri moduli.

**Fase 1 — MVP completo (funzioni richieste)**
- Presenze: richieste assenza + approvazione, export XLS/PDF.
- HACCP: CRUD frigo, inserimento temperature, evidenza fuori soglia + azione correttiva, stampa ESC/POS, firma.
- Inventario/ordini: categorie/prodotti/fornitori, flusso nuovo ordine, calcolo quantità, invio email, stampa checklist.
- Notifiche essenziali (email) per approvazioni e temperature fuori soglia.

**Fase 2 — Rifinitura e moduli complementari**
- Dashboard analytics, scadenzario documenti, manutenzioni, audit log UI, gestione turni base.
- App Android via Capacitor (build automatizzata in CI).
- Offline-first per HACCP/presenze.

**Fase 3 — Estensioni**
- Multi-locale completo, permessi granulari, multi-lingua, backup gestito, eventuale integrazione cassa/vendite.

---

## 9. Nota di deployment (stampanti di rete)

Le stampanti Epson POS via Ethernet devono essere raggiungibili dal container backend/worker sulla porta ESC/POS (tipicamente **9100/TCP**). Due scenari:

- **Locale con server on-premise** (un PC/mini-PC nel bar che fa da host Docker): nessun problema, backend e stampanti sono sulla stessa LAN — è la configurazione consigliata per v1.
- **Deploy cloud** (VPS esterno): serve un piccolo agente locale (o VPN site-to-site / WireGuard) che esponga le stampanti della LAN al backend cloud. Da valutare in Fase 2 se il locale non ha un server proprio.

Questa scelta va confermata con l'utente prima del deploy in produzione (vedi §10).

---

## 10. Decisioni ancora aperte (da confermare con l'utente)

- Dove verrà ospitato in produzione: server on-premise nel locale vs VPS cloud (impatta la strategia stampanti, vedi §9).
- Provider SMTP da usare per l'invio ordini (Gmail/Workspace, Aruba, altro) e relative credenziali.
- Se serve fin da subito il supporto multi-locale (più punti vendita) o se un singolo locale è sufficiente per la v1.
- Contratto orario dipendenti (per calcolo straordinari/ferie maturate): regole CCNL da applicare, se servono calcoli automatici di ferie maturate o basta il tracciamento presenze "grezzo".

---

## 11. Struttura repository

```
BarManager/
├── docs/
│   └── DEVELOPMENT.md          (questo documento)
├── docker-compose.yml
├── .env.example
├── backend/                    (NestJS API)
│   ├── prisma/schema.prisma
│   └── src/
│       ├── auth/
│       ├── users/
│       ├── attendance/         (presenze + leave-requests)
│       ├── haccp/
│       ├── inventory/
│       ├── printing/           (client ESC/POS)
│       └── reports/            (PDF/XLS)
└── frontend/                   (React + MUI PWA)
    └── src/
        ├── pages/attendance/
        ├── pages/haccp/
        └── pages/inventory/
```
