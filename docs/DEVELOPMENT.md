# BarManager — Documento di Sviluppo

> Piattaforma **multi-tenant** (un sotto-dominio per locale) per la gestione operativa di bar/ristoranti: presenze dipendenti, controlli HACCP, inventario e ordini fornitori, menù online, attività e scadenze — con una home dell'amministrazione che riepiloga ciò che richiede attenzione ogni giorno. Web app installabile come PWA, progettata per essere convertita in app Android nativa (wrapper Capacitor) senza riscrivere il frontend. Pensata per il deploy su **Portainer** o **Coolify**, dietro il loro reverse proxy.

Versione: 0.5 — Fase 1 rifinitura MVP completata (UI amministrazione, rate limiting, test, CI)
Data: 2026-09-21

---

## 1. Obiettivi e principi guida

- **Multi-tenant fin dall'inizio**: un'unica installazione serve N locali, ciascuno isolato per dati (`venueId` su ogni tabella) e raggiungibile sul proprio sotto-dominio (`locale1.tuodominio.it`, `locale2.tuodominio.it`, ...). Un **Super Admin** (gestore della piattaforma) crea i locali e l'account amministratore di ciascuno; l'**Admin di locale** gestisce solo il proprio locale, senza vedere gli altri.
- **Multi-modulo**: ogni funzione (presenze, HACCP, inventario, menù, ...) è un modulo indipendente, visibile in base al ruolo dell'utente autenticato.
- **Mobile-first / PWA**: l'app dev'essere pienamente usabile da smartphone (i dipendenti timbrano da telefono inquadrando un QR, i clienti leggono il menù da QR al tavolo), installabile come PWA, e predisposta per un wrapper Android (Capacitor) senza modifiche architetturali.
- **Deploy su piattaforme container esistenti**: nessun reverse proxy "nostro" da gestire — l'app si appoggia al reverse proxy già presente su **Portainer** (tipicamente Nginx Proxy Manager/Traefik) o **Coolify** (Traefik integrato), che si occupano di TLS e instradamento per dominio/sotto-dominio.
- **Material Design coerente**: **MUI (Material UI) v5**, unica libreria UI e unica libreria icone (**Material Symbols/Icons** via `@mui/icons-material`) per l'intera app — niente mix di framework CSS/icone diversi, tema chiaro/scuro definito centralmente, componenti puliti e accessibili.
- **Nessuna eliminazione senza conferma**: qualunque azione distruttiva (elimina timbratura, dipendente, attività, voce di menù, prodotto, ...) deve passare dal componente condiviso `ConfirmDialog` (`frontend/src/components/ConfirmDialog.tsx`) — mai `window.confirm()` del browser, mai una chiamata diretta alla mutation dal click. Vale per ogni nuova funzione di eliminazione, non solo per quelle già presenti.
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
| Test | **Jest** (backend, configurato — copertura unitaria sui punti critici: isolamento tenant, calcolo ordini, ricorrenza attività); **Playwright**/**React Testing Library** non ancora introdotti (v2) | qualità e non-regressione su moduli critici |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`): build + test ad ogni push/PR su backend e frontend | qualità continua |

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
- **ProductCategory / Product / Supplier / Order / OrderLine** — catalogo, scorte standard e flusso ordini; `Supplier.orderDays` (interi 1–7, lun–dom) indica i giorni ricorrenti in cui va fatto l'ordine, impostati dall'admin e usati per il promemoria in home (vedi §5.6).
- **MenuCategory** — categoria del menù online (es. "Antipasti", "Primi", "Vini"), con ordinamento.
- **MenuItem** — voce di menù: nome, descrizione, prezzo, foto, `allergens` (i 14 allergeni UE, enum), finestra di disponibilità oraria (`LUNCH`/`DINNER`/`ALL_DAY`), `visible` (mostra/nascondi dal menù pubblico), `unavailableUntil` (temporaneamente esaurito fino a una data/ora, calcolato automaticamente come non disponibile finché quel momento non è passato).
- **Task** — attività/scadenza (es. pagamento fornitore, visita medica dipendente, scadenza attestato): `type` (enum), `dueDate`, `status` (`OPEN/DONE`), `recurrence` (`NONE/MONTHLY/YEARLY`, genera automaticamente l'occorrenza successiva al completamento), `reminderDaysBefore` (da quanti giorni prima segnalarla come imminente in home), collegabile a un `Employee` (`relatedEmployeeId`, es. di chi è la visita medica).
- **AuditLog** — traccia di ogni operazione sensibile (chi, cosa, quando, prima/dopo), sempre scoperta per `venueId`.
- **Notification** — notifiche in-app (richieste ferie, temperature fuori soglia, ordini inviati, ...), esposte via API (lista/segna come letta) e riprese nella home amministrazione.
- **Table** *(proposta, §5.7, non ancora implementata)* — tavolo censito dall'admin: `label` (numero o nome, es. "12" o "Terrazza 2"), `seats` (posti), `active` (per togliere temporaneamente un tavolo, es. in manutenzione, senza perdere lo storico delle prenotazioni già assegnate).
- **Reservation** *(proposta, §5.7)* — richiesta di prenotazione di un cliente: nome, cognome, email, telefono, `partySize`, data/ora, `isEvent`+nota libera (es. "Compleanno"), note su intolleranze/allergie, altre note, `status` (`PENDING/CONFIRMED/REJECTED/CANCELLED`), `tableId` assegnato (manualmente o in automatico), `rejectionReason` (obbligatoria se rifiutata). Isolata per `venueId` come tutte le altre entità.
- Nuovi campi previsti su **Venue** per le impostazioni del modulo prenotazioni: `reservationsEnabled`, `reservationAutoConfirmMaxSeats` (soglia sopra la quale serve sempre conferma manuale), `reservationSlotDurationMinutes` (durata di occupazione di un tavolo, per calcolare sovrapposizioni/turni).

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

**Metodi di timbratura verificata — l'admin ne abilita anche più di uno insieme (`Venue.clockIn*Enabled`):**
1. **QR di postazione** (anti-frode, presenza fisica): l'admin genera/stampa un QR per ogni postazione (es. ingresso), che incapsula un URL tipo `https://locale1.tuodominio.it/clock/{qrToken}`. Il dipendente lo inquadra → apre la PWA del **proprio** locale già loggata sulla pagina di timbratura. Registrata con `source: QR`.
2. **GPS**: l'admin imposta una volta la posizione del locale (cattura dal browser) e un raggio in metri (default 20). Dalla home, il dipendente preme il pulsante GPS: il browser chiede la posizione, il server ricalcola la distanza dal punto del locale (formula haversine) e rifiuta se fuori raggio. Le coordinate esatte del locale non sono mai esposte al client, solo i metodi abilitati. Registrata con `source: GPS`.
3. **Tag NFC**: l'admin censisce in app un'etichetta e un testo per ogni tag, poi scrive lo stesso testo sul tag fisico con un'app di terze parti (BarManager non scrive NFC, solo legge). Dalla home, il dipendente avvicina il telefono al tag (Web NFC — Chrome su Android): il testo letto è confrontato con quelli censiti per il locale. Registrata con `source: NFC`.
4. **Diretta dall'app** (fallback): se il locale non ha abilitato nessuno dei tre metodi sopra, resta disponibile il pulsante diretto senza verifica, come in v1. Registrata con `source: MANUAL`.

In tutti i casi: stato corrente evidenziato in home, timestamp sempre server-side (mai quello del client). Anti-doppio-click: se l'ultimo evento è "inizio" senza "fine", il pulsante mostra solo "Fine turno" e viceversa.

**Amministrazione:** vista tabellare (storico timbrature) con correzione manuale (data/ora + motivo obbligatorio, `source: CORRECTION`, tracciata in audit log) ed export XLS/PDF per periodo. QR di postazione, tag NFC e metodi abilitati si gestiscono dalla sezione "Metodi di timbratura".

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

### 5.5 Attività e scadenze

Modulo generico per tenere traccia di impegni con una data entro cui vanno fatti, che non rientrano negli altri moduli: pagamento fornitori, visita medica dipendenti, scadenza attestati/corsi obbligatori, manutenzioni.

- Ogni attività ha titolo, descrizione libera, tipo (pagamento fornitore / visita medica / scadenza attestato / manutenzione / generica), scadenza, ed **entro quanti giorni prima** va segnalata come imminente in home (`reminderDaysBefore`, default 7).
- Può essere collegata a un dipendente (es. "Visita medica — Mario Rossi").
- **Ricorrenza**: non ricorrente, mensile o annuale — utile per scadenze periodiche come il rinnovo di un attestato. Al completamento di un'attività ricorrente viene creata subito la prossima occorrenza con la scadenza spostata di un mese/anno, così non va reinserita a mano ogni volta.
- Le attività aperte, evidenziando quelle scadute, alimentano la home dell'amministrazione (§5.6).

### 5.6 Home dell'amministrazione

All'accesso, Admin e Manager vedono in cima alla home un riepilogo di ciò che richiede attenzione **oggi**, prima ancora dei moduli:

- **Richieste dei dipendenti in attesa** (richieste ferie/permessi/malattia non ancora approvate/rifiutate), con approvazione/rifiuto rapido direttamente dalla card, senza dover entrare nel modulo Presenze.
- **Ordini da fare oggi**: fornitori il cui giorno di ordine ricorrente (impostato in "Fornitori", vedi §5.3) coincide con il giorno corrente (es. ogni lunedì, o lunedì e giovedì), con collegamento diretto al flusso "nuovo ordine" per quel fornitore.
- **Scadenze imminenti/scadute** dal modulo Attività e scadenze, con conteggio delle scadute e completamento rapido.
- **Altre notifiche** del giorno (temperature HACCP fuori soglia, ordini inviati, richieste ferie riviste, ...), con possibilità di segnarle come lette.

Se non c'è nulla che richiede attenzione, la sezione lo segnala esplicitamente invece di restare vuota. I moduli operativi restano comunque disponibili come tile sotto il riepilogo, per l'uso normale.

### 5.7 Prenotazioni tavoli *(proposta di progettazione — non ancora implementata)*

Modulo per raccogliere prenotazioni online senza che il cliente debba telefonare: conferma automatica per le richieste piccole quando c'è posto, revisione manuale del locale per quelle grandi o quando la capienza è al limite.

**Pagina/widget pubblico (nessun login):**
- Raggiungibile su `https://locale1.tuodominio.it/prenota`, stessa risoluzione per sotto-dominio del menù pubblico (§5.4); pensata anche per essere **embeddata come widget** (`<iframe>`) nel sito esterno del locale, se ne ha uno.
- Il cliente inserisce: nome, cognome, email, telefono, numero di persone, data e orario, note libere, eventuali intolleranze/allergie ed **evento** opzionale (interruttore "È per un'occasione speciale?" + testo libero, es. "Compleanno").
- L'orario proponibile è vincolato alle fasce pranzo/cena del locale (`Venue.lunchStart/lunchEnd/dinnerStart/dinnerEnd`, già esistenti per il menù, §5.4) e a un orizzonte massimo di prenotabilità (es. 30 giorni, configurabile).
- All'invio il cliente riceve subito un'email: "richiesta ricevuta, in attesa di conferma" oppure, se confermata automaticamente (vedi sotto), "prenotazione confermata" con data/ora/numero di persone.

**Calcolo disponibilità e blocco overbooking:**
- Ogni prenotazione occupa i tavoli per una finestra di tempo pari a `data/ora scelta` + `Venue.reservationSlotDurationMinutes` (default proposto: 120 minuti — impostabile per gestire sia "un turno = tutto il servizio" sia più turni nello stesso servizio, cioè il tavolo si libera e può essere riprenotato più avanti nella stessa fascia).
- I **posti disponibili** per una data/ora richiesta = somma dei posti di tutti i tavoli attivi − somma dei posti delle prenotazioni (`PENDING` o `CONFIRMED`) la cui finestra si sovrappone a quella richiesta.
- Se la nuova richiesta supererebbe i posti disponibili, viene **bloccata**: il cliente vede un messaggio del tipo "al momento non ci sono posti disponibili per l'orario scelto" (con eventuale proposta di un orario alternativo), e viene generato un **Alert per l'admin** (notifica in-app, riusando il modello `Notification` già esistente, §4) — utile per capire quando la domanda supera la capienza e valutare se aprire altri turni/tavoli.

**Conferma automatica vs manuale:**
- Impostazione admin: **soglia massima di posti per la conferma automatica** (`x`, default proposto 6, in "Impostazioni prenotazioni").
- Richiesta con posti **≤ x** e capienza disponibile: il sistema tenta l'**assegnazione automatica del tavolo** (algoritmo sotto); se trova un tavolo adatto, la prenotazione passa subito a `CONFIRMED` e il cliente riceve l'email di conferma senza attese. Se non lo trova (es. nessun tavolo singolo con posti sufficienti, anche se la capienza totale ci sarebbe combinando più tavoli — la combinazione automatica di più tavoli è fuori scope v1, vedi §10), resta `PENDING` per revisione manuale.
- Richiesta con posti **> x**: resta **sempre** `PENDING` e richiede conferma manuale dell'admin, **anche se** l'assegnazione automatica ha già trovato un tavolo adatto (in tal caso il tavolo suggerito è già precompilato: l'admin deve solo confermarlo o cambiarlo). I gruppi grandi/gli eventi meritano un controllo umano — disponibilità reale, esigenze particolari, eventuale conferma telefonica.

**Algoritmo di assegnazione automatica (massimizzare l'occupazione):**
- Tra i tavoli attivi e liberi nella finestra richiesta (nessuna prenotazione `PENDING`/`CONFIRMED` sovrapposta su quel tavolo), si sceglie il **più piccolo tavolo con posti sufficienti** (posti ≥ persone richieste, tavoli ordinati per posti crescenti — strategia *best-fit*): lascia liberi i tavoli grandi per i gruppi che ne hanno davvero bisogno, invece di sprecare un tavolo da 8 per una coppia.
- Se nessun tavolo singolo basta, in v1 la richiesta resta manuale: l'admin può decidere di accostare fisicamente due tavoli e assegnarli entrambi a mano (la modellazione esplicita di più tavoli per la stessa prenotazione è una possibile estensione v2, vedi §10).

**Amministrazione:**
- **Tavoli**: CRUD — numero/nome e posti per tavolo, disattivabile senza perdere lo storico delle prenotazioni già assegnate.
- **Prenotazioni**: coda delle richieste in attesa (`PENDING`) con azioni rapide **Accetta**/**Rifiuta** (il rifiuto richiede un motivo, riportato al cliente via email); vista per giornata/servizio con tavolo assegnato, stato, contatti e note; **riassegnazione manuale** del tavolo in qualsiasi momento, anche su una prenotazione già confermata. Contatore "posti disponibili" per data/servizio sempre visibile.
- **Impostazioni prenotazioni**: attiva/disattiva il modulo, soglia posti per conferma automatica, durata di occupazione del tavolo (minuti), orizzonte massimo di prenotabilità.
- Una volta implementato, le prenotazioni in attesa di conferma e i blocchi per overbooking alimenterebbero anche la home dell'amministrazione (§5.6), sullo stesso principio delle richieste ferie e degli ordini del giorno.

**Integrazione con Google (ricerca/Maps):** tre livelli possibili, con impegno molto diverso — dal semplice link a un vero progetto a parte:

1. **Link di prenotazione su Google Business Profile** *(subito, zero sviluppo lato BarManager)* — ogni locale, dal proprio account Google Business Profile ("Prenotazioni" → "Aggiungi link"), può incollare l'URL della pagina pubblica `/prenota`. Compare come link generico ("Prenota") nella scheda del locale su Search/Maps, di norma attivo entro 24-48 ore. È una configurazione che fa il gestore del locale sul proprio account Google, non richiede nessuna integrazione né codice da parte nostra. Non dà il bottone blu nativo "Prenota" né la disponibilità in tempo reale — solo un link verso il nostro widget.
2. **Dati strutturati sulla pagina pubblica** (`ReserveAction`/`FoodEstablishmentReservation`, schema.org — sviluppo minimo: un blocco JSON-LD con nome locale, orari e l'azione di prenotazione con URL, sulla pagina `/prenota`) — può far comparire un'azione "Prenota" nei risultati di ricerca, ma **non è garantito**: è Google a decidere autonomamente se e quando mostrarlo, non è un'integrazione formale né richiede approvazione.
3. **"Reserve with Google" vero e proprio** (bottone blu nativo + disponibilità in tempo reale su Search/Maps) — richiede che **BarManager stesso** (non il singolo locale) diventi **partner approvato** di Google tramite l'Actions Center (API "Reservations end-to-end"): relazione contrattuale diretta con i locali, indirizzo di ciascuno corrispondente alla sua scheda Google Maps, ed esposizione a Google — in tempo reale — di disponibilità e stato prenotazione nel formato standard richiesto (persone, fasce orarie, conferma), che ricalca bene il modello `Table`/`Reservation` già progettato sopra. È un impegno molto più grande della sola app: domanda di partnership, revisione tecnica di Google, requisiti di affidabilità/performance continui (Google monitora ad es. il tempo medio di completamento di una prenotazione). Va trattato come **progetto separato**, da confermare esplicitamente (§10), non come parte del rilascio v1. Alternativa più rapida ma meno indipendente: integrarsi non direttamente con Google ma con un aggregatore già partner (es. Eat App, Tableo, resOS, SevenRooms) che fa da tramite — a costo di una dipendenza (spesso un abbonamento) da quella piattaforma terza, che finirebbe in parte a sovrapporsi con quanto BarManager offrirebbe già in proprio.

---

## 6. Altri moduli utili individuati (proposte)

1. **Gestione turni/pianificazione (shift planning)** — collegata alle presenze: confronto pianificato vs timbrato.
2. **Ruoli e permessi granulari** — oltre a Admin/Manager/Employee, "responsabile" di una o più categorie/reparti.
3. **Notifiche push** — quelle in-app/email essenziali sono implementate (§5.6); manca l'invio push via PWA per gli avvisi che richiedono attenzione immediata (temperatura fuori soglia, scadenza attività).
4. ~~Scadenzario documenti~~ — **implementato** come modulo Attività e scadenze (§5.5): copre certificati/attestati, pagamenti, visite mediche, manutenzioni con promemoria in home; resta da aggiungere l'allegato file (es. copia del certificato) alla singola attività.
5. **Manutenzioni attrezzature** — un log dedicato con interventi/tecnico intervenuto, oltre alla singola attività "manutenzione" già gestibile col modulo Attività e scadenze.
6. **Gestione fornitori estesa** — listini/prezzi storici, tempi di consegna medi.
7. **Dashboard analytics** — costo personale, andamento ordini/spesa, non conformità HACCP, assenteismo; per il Super Admin, KPI aggregati su tutti i locali.
8. **Audit log consultabile** — vista admin "chi ha fatto cosa".
9. **Backup automatico** — dump schedulato del DB su storage esterno S3-compatibile.
10. **Multi-lingua UI** — i18n (react-i18next) per menù pubblico e app dipendenti (molti non madrelingua italiani); il menù pubblico multi-lingua è particolarmente utile per clientela turistica.
11. **Modalità offline-first per HACCP/presenze** — service worker con coda locale (IndexedDB).
12. **QR per tavolo con ordinazione** — evoluzione naturale del menù online: dal semplice "consulta" a un vero e proprio invio ordine al tavolo (fuori scope v1, ma il modello `MenuItem` è già compatibile).
13. **Integrazione futura con cassa/POS di vendita** — collegamento a incassi/consumi reali per suggerire automaticamente la `standardQty`.
14. ~~Prenotazioni tavoli online~~ — **progettato** in dettaglio in §5.7 (non ancora implementato): widget pubblico di prenotazione, tavoli con posti, assegnazione automatica/manuale che massimizza l'occupazione, conferma automatica sotto una soglia di posti configurabile, blocco delle richieste che superano la capienza con alert admin.

Nel roadmap (§8) questi sono marcati come v1 (fondamentali, bassa complessità aggiuntiva) o v2/v3 (da valutare con l'utente).

---

## 7. Sicurezza, conformità e isolamento multi-tenant

- Password hashate con **argon2id**; JWT access token a vita breve (15 min) + refresh token.
- **RBAC** a livello di endpoint (guard NestJS) e di UI. Il ruolo `SUPER_ADMIN` non ha accesso agli endpoint operativi dei locali (presenze/HACCP/inventario/menù), solo a quelli di gestione `Venue`.
- **Permessi granulari per modulo** (oltre al ruolo): l'Admin di locale può concedere a ciascun dipendente, indipendentemente dal ruolo Dipendente/Responsabile, l'accesso ai moduli HACCP/Inventario/Menù/Attività (`Employee.allowedModules`, gestito dalla pagina Dipendenti). Verificato lato server ad ogni richiesta da `ModuleAccessGuard` (non solo lato UI); l'Admin non è mai limitato da questo meccanismo. Elenco vuoto = permessi di default del ruolo (Responsabile: tutti; Dipendente: solo HACCP), per compatibilità con i dipendenti già esistenti.
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

**Fase 0-bis — Multi-tenant + Menù**
- Ruolo `SUPER_ADMIN` e modulo gestione locali (creazione locale + primo admin).
- `TenantMiddleware` per risoluzione sotto-dominio, isolamento dati per `venueId` verificato su ogni servizio.
- Modulo Menù online completo (categorie, voci, allergeni, disponibilità oraria, visibilità, "non disponibile fino a") + pagina pubblica senza login.
- Adeguamento Docker Compose/Nginx per deploy dietro il reverse proxy di Portainer/Coolify (nessun Traefik proprio, proxy `/api` same-origin).

**Fase 0-ter — Attività/scadenze + home amministrazione (questo aggiornamento)**
- Modulo Attività e scadenze (§5.5), con ricorrenza mensile/annuale.
- Giorni di ordine ricorrenti per fornitore (§5.3) e relativa UI di gestione fornitori.
- Endpoint notifiche (lista/segna come letta) ed endpoint di riepilogo `/dashboard/admin-summary`.
- Home dell'amministrazione (§5.6): richieste pendenti con approvazione rapida, ordini del giorno, scadenze imminenti/scadute, notifiche.

**Fase 0-quater — Compose di produzione (questo aggiornamento)**
- `docker-compose.yml` passato allo stage `production` dei Dockerfile (era `dev`, non adatto a un deploy reale); `docker-compose.override.yml` aggiunto per mantenere invariata l'esperienza di sviluppo in locale (§9.0).
- CLI di Prisma spostata tra le dipendenze di runtime, altrimenti assente nell'immagine di produzione (`npm ci --omit=dev`) e `prisma db push` non sarebbe potuto girare all'avvio del container.

**Fase 1 — Rifinitura MVP (completata)**
- UI di amministrazione per dipendenti, categorie/prodotti, stampanti (prima disponibili solo via API).
- Impostazioni locale: fasce orarie pranzo/cena modificabili dall'Admin (prima fisse ai default).
- Menù: riordino categorie (su/giù) e ritaglio foto prima dell'upload.
- Presenze: QR generabili/scaricabili per le postazioni di timbratura, export XLS/PDF esposto in UI.
- HACCP: censimento frigo/congelatori, tabella giornaliera, storico azioni correttive — prima solo via API.
- Attività: ricorrenza anche settimanale (oltre mensile/annuale), selettore dipendente in creazione.
- Rate limiting: `ThrottlerGuard` applicato globalmente (era registrato ma mai attivato) + limite più stretto su login/refresh.
- Isolamento tenant: corretti due punti che non verificavano lato server l'appartenenza al locale di risorse riferite per id (creazione prodotto, creazione ordine).
- Test automatici (Jest) sui punti critici — isolamento tenant, calcolo quantità ordini, avanzamento ricorrenza attività — e CI GitHub Actions (build + test) ad ogni push/PR.

Resta aperto: notifica push via PWA per gli avvisi urgenti (oggi solo in-app/email), allegati alle attività/scadenze.

**Fase 2 — Moduli complementari**
- Dashboard analytics (anche aggregata multi-locale per il Super Admin), scadenzario documenti, manutenzioni, audit log UI, gestione turni base.
- **Prenotazioni tavoli** (progettato in §5.7): tavoli, widget pubblico, assegnazione automatica/manuale, conferma automatica sotto soglia, blocco overbooking con alert admin.
- App Android via Capacitor.
- Offline-first per HACCP/presenze.

**Fase 3 — Estensioni**
- Permessi granulari, multi-lingua (incluso menù pubblico), backup gestito, QR tavolo con ordinazione, integrazione cassa/vendite.
- *(se confermato, progetto separato)* Partnership "Reserve with Google" di livello 3 per le Prenotazioni (§5.7): richiede domanda a Google come piattaforma, non è collegata al rilascio v1 del modulo.

---

## 9. Nota di deployment

### 9.0 Due file compose: produzione vs sviluppo

- `docker-compose.yml` è il file di **produzione**: costruisce lo stage `production` dei Dockerfile (backend compilato con `nest build`, frontend buildato con Vite e servito da Nginx), senza montare il codice sorgente nei container. È questo il file che Portainer/Coolify leggono collegandosi al repository.
- `docker-compose.override.yml` esiste **solo per lo sviluppo in locale**: Docker Compose lo carica automaticamente insieme a `docker-compose.yml` quando lanci `docker compose up` da questa cartella (nessuna opzione da aggiungere), riportando i servizi allo stage `dev` con hot reload e bind mount del codice. Portainer e Coolify, collegandosi al repository Git, non lo considerano affatto: usano solo `docker-compose.yml`.
- La CLI di Prisma (`prisma`) è tenuta come **dipendenza di runtime** (non solo di sviluppo) apposta: serve per eseguire `prisma db push` all'avvio del container anche nell'immagine di produzione, dove le `devDependencies` sono escluse (`npm ci --omit=dev`).

### 9.1 Portainer / Coolify e sotto-domini

- **DNS**: creare un record **wildcard** `*.tuodominio.it → IP del server` (oltre, se serve, ad `admin.tuodominio.it` se si preferisce un sotto-dominio dedicato invece della wildcard per l'host di amministrazione).
- **Coolify** — passi:
  1. *New Resource* → **Docker Compose**, collegando il repository (branch `main`); Coolify legge `docker-compose.yml`.
  2. Impostare le variabili d'ambiente nella sezione *Environment Variables* della risorsa (stesso contenuto di `.env.example`: credenziali Postgres, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, SMTP, `ROOT_DOMAIN`, ...) — Coolify genera da sé il file `.env` che il compose si aspetta (`env_file: .env`).
  3. Assegnare il dominio al servizio **frontend** (porta 80): `*.tuodominio.it` per la wildcard (richiede un provider DNS collegato a Coolify per la validazione **DNS-01**, obbligatoria per i certificati wildcard) oppure un dominio singolo in assenza di wildcard. Il servizio **backend** non va esposto pubblicamente.
  4. Deploy. Il primo avvio applica lo schema con `prisma db push`; creare l'utente iniziale con `docker compose exec backend npm run prisma:seed` (terminale Coolify o SSH) e cambiare subito le password di default (`backend/prisma/seed.ts`).
- **Portainer**: si importa `docker-compose.yml` come stack (Stacks → Add stack → Repository); se davanti c'è Traefik o Nginx Proxy Manager, va aggiunta a mano la regola di routing per `*.tuodominio.it` verso il servizio `frontend` (porta 80) — un esempio di label Traefik è incluso, commentato, in `docker-compose.yml`.
- L'app **non** include un proprio container reverse proxy: il traffico arriva già in chiaro (HTTP) dal proxy della piattaforma al container `frontend`, che fa da unico punto d'ingresso (proxando `/api` e `/uploads` al backend).

### 9.2 Stampanti di rete

La stampa (report HACCP, checklist ordini, test da Impostazioni) non parte dal server: il backend prepara solo il contenuto testuale (`PrintingService.buildTestJob`/`buildReportJob`, che restituiscono `{title, lines, footer}`) e il **browser** lo stampa con la stampa standard del sistema operativo (`window.print()` su un iframe nascosto, formattato a larghezza scontrino — `frontend/src/printing/printJob.ts`).

Il motivo di questa scelta: nessuna libreria browser può aprire una connessione diretta (TCP) verso una stampante di rete — è un limite di sicurezza della piattaforma web, non risolvibile lato codice (verificato anche con librerie dedicate come QZ Tray, receipt.js/receiptjs, `@point-of-sale/*`: tutte richiedono comunque un componente esterno — un helper desktop, o l'app "print service" del sistema operativo — per il salto finale sulla rete). Da qui la scelta di appoggiarsi al sistema di stampa del dispositivo:

- **Windows/macOS/Linux**: la stampante va configurata come stampante di sistema (driver, o via IP se il sistema lo supporta); il dialogo di stampa la mostra tra le opzioni.
- **Android**: va installata una volta un'app che fa da "print service" e sa parlare ESC/POS in rete, es. [RawBT](https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter) (gratuita): una volta installata compare come stampante nel dialogo di stampa standard di Android (quindi anche da Chrome/WebView), e consegna il contenuto alla stampante via WiFi/LAN, Bluetooth o USB.
- **iOS**: nessuna soluzione altrettanto generica; funziona solo con stampanti realmente certificate AirPrint (alcuni modelli Star Micronics).
- Questo funziona a prescindere da dove sia ospitato il backend (on-premise o cloud): il dialogo di stampa e la consegna avvengono sempre sul dispositivo/rete di chi stampa, non sul server.
- Limite noto: non essendo stampa ESC/POS raw, si perdono i comandi di formattazione diretta (grassetto, taglio automatico della carta) — si stampa una pagina HTML semplice, e non c'è modo per il browser di sapere se l'utente ha davvero confermato la stampa dal dialogo (si considera "stampato" non appena il dialogo si apre).
- Se in futuro serve tornare a stampa ESC/POS raw pilotata dal server (bordi/tagli, nessun dialogo, ma richiede un helper installato): QZ Tray per desktop resta un'opzione valida (non per Android, dove non esiste), oppure — visto che il progetto prevede già un wrapper Capacitor per Android (v. sopra) — un plugin nativo Capacitor con socket TCP diretto (es. libreria Android `DantSu/ESCPOS-ThermalPrinter-Android`, con wrapper `capacitor-thermal-printer`), che stampa in silenzio senza dialogo né app di terze parti.

---

## 10. Decisioni ancora aperte (da confermare con l'utente)

- Dominio principale da usare per la wildcard (es. `tuodominio.it`) e provider DNS (necessario per il certificato wildcard via DNS-01 su Coolify).
- Host riservato al Super Admin: sotto-dominio dedicato (`admin.tuodominio.it`) o dominio apice.
- Storage delle foto del menù: volume Docker locale (default attuale, più semplice) oppure S3/MinIO fin da subito, se si prevede un deploy multi-host senza volumi condivisi.
- Dove verrà ospitato in produzione: server on-premise vs VPS cloud (impatta la strategia stampanti, vedi §9.2).
- Provider SMTP: globale di piattaforma (un solo mittente per tutti i locali) oppure configurabile per singolo locale.
- Contratto orario dipendenti (per calcolo straordinari/ferie maturate): regole CCNL da applicare.
- **Prenotazioni (§5.7)** — da confermare prima di iniziare l'implementazione:
  - Durata standard di occupazione di un tavolo (default proposto 120 minuti) e se un locale userà davvero il turnover (più prenotazioni sullo stesso tavolo in orari diversi dello stesso servizio) o preferisce "un turno = tutto il servizio".
  - Se serve, fin da v1, la combinazione automatica di più tavoli per un unico gruppo grande, o basta l'assegnazione manuale dell'admin (v1 proposta: solo manuale).
  - Se le richieste bloccate per overbooking vanno solo rifiutate o messe in una "lista d'attesa" consultabile dall'admin, nel caso si liberi un posto per cancellazione.
  - Se, oltre all'email, serve un promemoria via SMS/WhatsApp al cliente (richiederebbe un provider terzo, es. Twilio — fuori scope v1).
  - Se il cliente deve poter annullare/modificare la propria prenotazione da un link nell'email di conferma (self-service), o solo l'admin può farlo.
  - Giorni di chiusura/ferie del locale da bloccare esplicitamente nel calendario prenotazioni: oggi il `Venue` ha solo fasce orarie pranzo/cena, non giorni di chiusura.
  - Se e quando perseguire l'integrazione "Reserve with Google" di **livello 3** (§5.7): richiede una domanda di partnership a Google **a nome di BarManager come piattaforma**, non del singolo locale, con impegni tecnici e di affidabilità continui — da trattare come progetto separato, non come parte del rilascio v1. I livelli 1 e 2 (link su Google Business Profile, dati strutturati sulla pagina pubblica) sono invece adottabili da subito, a costo quasi nullo, non appena la pagina `/prenota` esiste.

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
│       ├── tasks/               (attività e scadenze, con ricorrenza)
│       ├── notifications/       (lista/segna come letta)
│       ├── dashboard/           (riepilogo home amministrazione)
│       ├── printing/            (client ESC/POS)
│       ├── reports/             (PDF/XLS)
│       └── reservations/        (§5.7 — proposta, non ancora creata: tavoli, prenotazioni, widget pubblico)
└── frontend/                   (React + MUI PWA)
    └── src/
        ├── components/AdminSummary.tsx  (riepilogo in home)
        ├── pages/super-admin/
        ├── pages/attendance/
        ├── pages/haccp/
        ├── pages/inventory/     (nuovo ordine + fornitori/giorni ordine)
        ├── pages/menu/          (admin + pagina pubblica)
        ├── pages/tasks/
        └── pages/reservations/  (§5.7 — proposta, non ancora creata: admin tavoli/prenotazioni + pagina pubblica /prenota)
```
