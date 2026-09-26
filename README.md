# BarManager

Piattaforma **multi-tenant** (web, PWA, containerizzata con Docker) per la gestione operativa completa di bar, ristoranti, pub e pizzerie.
Ogni locale dispone di un proprio ambiente isolato su sotto-dominio dedicato (es. `nome-locale.tuodominio.it`), con supporto per il deploy su **Coolify** o **Portainer**.

---

## Moduli e Funzionalità Principali

### 1. Ordini Online (Asporto e Consegna a Domicilio)
* **Menù e Carrello Pubblico:** catalogo con foto, prezzi, varianti, gruppi di modificatori/aggiunte con ricalcolo immediato del totale, filtri per allergeni e categorie.
* **Modalità Ritiro e Consegna:**
  * Supporto raggio massimo di consegna (in metri) calcolato dalla posizione GPS del locale.
  * Spese di consegna configurabili e soglia per la consegna gratuita.
  * Mappa interattiva OpenStreetMap / Leaflet con geocodifica indirizzo, zoom automatico a livello strada (zoom 17) e puntatore trascinabile per correzioni di precisione.
* **Gestione Orari e Turni di Produzione:**
  * Orari dedicati alla cucina/asporto separati dagli orari generali del locale (con fallback automatico se non impostati).
  * Gestione completa delle chiusure a mezzanotte (`00:00`), turni notturni oltre mezzanotte e aperture speciali con orari personalizzati.
  * Scelta tra ordine *"Il prima possibile"* (ASAP) o programmato su slot da 15 minuti.
  * Anticipo minimo di preparazione (*lead time*) per garantire alla cucina il tempo necessario prima della chiusura del turno.
* **Accettazione Automatica e Capienza:**
  * Limite di ordini per slot da 15 minuti con gestione combinata (`COMBINED`) o separata per asporto e consegna (`SEPARATE`).
  * Ordini fuori orario o a turno saturo salvati in attesa di riapertura (`awaitingShopOpening`), mai auto-accettati senza approvazione dello staff.
* **Pagamenti Online e alla Consegna:**
  * Integrazione **SumUp Online Payments** (carte di credito/debito e BANCOMAT Pay) con rimborso automatico in caso di rifiuto della comanda da parte del locale.
  * Pagamento in contanti o POS alla consegna/ritiro.
* **Coda Operativa Staff:**
  * Dashboard in tempo reale con notifiche sonore all'arrivo di nuovi ordini.
  * Avanzamento stati: `In attesa (PENDING) → Confermato (CONFIRMED) → Pronto (READY) → Completato (COMPLETED)`.
  * Proposta di modifica orario con invio link di conferma rapido al cliente.
  * Tasto rapido **Naviga** per avviare Google Maps direttamente sulle coordinate di consegna del cliente.
  * Stampa scontrini PDF: comanda cucina (senza prezzi) e scontrino fiscale/commerciale completo.
  * Sincronizzazione automatica con **Loyverse POS** alla chiusura della comanda.

### 2. Prenotazioni Tavoli Online
* Widget pubblico per prenotazione tavoli con selezione data, turno (pranzo / cena) e orario vincolato agli orari di apertura e capienza del locale.
* Gestione capienza per fascia oraria, anticipo minimo e numero massimo di coperti per tavolo.
* Notifiche email automatiche di conferma, proposta cambio orario o rifiuto con motivazione.

### 3. Clienti & CRM Unificato
* Anagrafica clienti unificata alimentata in automatico da ordini online e prenotazioni.
* Deduplica intelligente su email e numero di telefono.
* Statistiche per cliente: numero prenotazioni, numero ordini online, spesa totale cumulata e data ultima interazione.

### 4. Menù Digitale & QR Code
* Catalogo piatti e bevande per categorie, con allergeni, foto in alta risoluzione, varianti e prezzi.
* Disponibilità oraria per turno (es. solo pranzo, solo cena, tutto il giorno) e marcatura temporanea di esaurito (*unavailable until*).
* Visualizzazione pubblica ottimizzata per dispositivi mobili via QR al tavolo, con logo del locale e tema personalizzato.

### 5. Presenze & Personale
* Timbratura rapida entrate/uscite dei dipendenti tramite QR code univoco e geofencing GPS opzionale.
* Gestione richieste assenza (ferie, permessi, malattia) con approvazione rapida dalla home.
* Export report presenze mensili e totali ore lavorate in formato Excel e PDF.

### 6. Controlli HACCP
* Registrazione quotidiana delle temperature di frigoriferi, celle e pozzetti.
* Schede di pulizia e sanificazione periodica degli ambienti.
* Stampa report HACCP periodici e supporto per stampa termica su stampanti ESC/POS Epson.

### 7. Inventario & Ordini Fornitori
* Gestione prodotti, scorte minime, unità di misura e fornitori con giorni di consegna dedicati.
* Calcolo automatico della lista della spesa in base ai consumi e alle giacenze minime.
* Invio ordini ai fornitori via email con allegato PDF e generazione checklist di carico merci.

### 8. Scadenze, Bacheca & Knowledge Base
* Scadenze operative con notifiche email (visite mediche, attestati HACCP/sicurezza, manutenzioni macchinari, scadenze fiscali).
* Bacheca annunci interna con tracciamento delle conferme di lettura dello staff.
* Knowledge Base interna con procedure operative, ricette standard e manuali di sala/cucina.

---

## Stack Tecnologico

* **Backend:** [NestJS](https://nestjs.com/) (TypeScript) + [Prisma ORM](https://www.prisma.io/) + [PostgreSQL](https://www.postgresql.org/) + [Redis](https://redis.io/)
* **Frontend:** [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [MUI (Material UI v5)](https://mui.com/)
* **Mappe & Geolocalizzazione:** [Leaflet](https://leafletjs.com/) + [React-Leaflet](https://react-leaflet.js.org/) + [LocationIQ API](https://locationiq.com/)
* **Integrazioni:** [SumUp Payments API](https://developer.sumup.com/), [Loyverse API](https://developer.loyverse.com/), Nodemailer (SMTP transazionale), PDFKit
* **Deploy:** Docker multi-stage build, Docker Compose, Nginx (frontend statico e reverse proxy interno)

---

## Avvio Rapido in Sviluppo

```bash
# 1. Copia e configura le variabili d'ambiente
cp .env.example .env

# 2. Avvia i container con Docker Compose
docker compose up --build
```

* **Frontend:** `http://localhost:5173`
* **Backend API:** `http://localhost:3000/api`

In ambiente locale, il menù e gli ordini pubblici accettano il parametro `?venueSlug=demo` in query string per simulare il sotto-dominio del locale.

Al primo avvio, per popolare il database con i dati iniziali:
```bash
docker compose exec backend npm run prisma:seed
```

Credenziali di default generate dal seed:
* **Super Admin:** `superadmin@barmanager.local` / `superadmin123`
* **Admin Locale Demo:** `admin@barmanager.local` / `admin123`

---

## Deploy in Produzione (Coolify / Portainer)

Il file `docker-compose.yml` è pronto per il deploy diretto: compila le immagini di produzione (senza bind mount del codice sorgente locale).

1. Su **Coolify**, crea una nuova risorsa **Docker Compose** collegata a questo repository (`main`).
2. Configura le variabili d'ambiente nella sezione *Environment Variables* della risorsa (vedi `.env.example`).
3. Assegna al servizio **frontend** il dominio wildcard `*.tuodominio.it` sulla porta **80** (con certificato SSL Let's Encrypt tramite DNS challenge).
4. Il backend non richiede esposizione pubblica: viene raggiunto solo internamente dal frontend tramite la rete Docker.

---

## Documentazione Dettagliata

Per la specifica tecnica completa dell'architettura, del data model e delle logiche di business, consulta:
* [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
