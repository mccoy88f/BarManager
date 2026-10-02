# BarManager

Piattaforma **multi-tenant** (web, PWA, containerizzata con Docker) per la gestione operativa completa di bar, ristoranti, pub e pizzerie.
Ogni locale dispone di un proprio ambiente isolato su sotto-dominio dedicato (es. `nome-locale.tuodominio.it`), con supporto per il deploy su **Coolify** o **Portainer**.

---

## Moduli e Funzionalità Principali

### 1. Ordini Online (Asporto e Consegna a Domicilio)
* **Menù e Carrello Pubblico:** catalogo con foto, prezzi, varianti, gruppi di modificatori/aggiunte con ricalcolo immediato del totale, filtri per allergeni e categorie. Carrello persistente nel browser e precompilazione dei dati di contatto/consegna al prossimo ordine.
* **Modalità Ritiro e Consegna:**
  * Supporto raggio massimo di consegna (in metri) calcolato dalla posizione GPS del locale.
  * Spese di consegna configurabili e soglia per la consegna gratuita; ordine minimo configurabile.
  * Mappa interattiva OpenStreetMap / Leaflet con geocodifica indirizzo, zoom automatico a livello strada (zoom 17) e puntatore trascinabile per correzioni di precisione.
* **Gestione Orari e Turni di Produzione:**
  * Orari dedicati alla cucina/asporto separati dagli orari generali del locale (con fallback automatico se non impostati).
  * Gestione completa delle chiusure a mezzanotte (`00:00`), turni notturni oltre mezzanotte e aperture speciali con orari personalizzati.
  * Scelta tra ordine *"Il prima possibile"* (ASAP) o programmato su slot da 15 minuti, con messaggio di attesa apertura per gli ordini fuori orario.
  * Anticipo minimo di preparazione (*lead time*) per garantire alla cucina il tempo necessario prima della chiusura del turno.
* **Accettazione Automatica e Capienza:**
  * Limite di ordini per slot da 15 minuti con gestione combinata (`COMBINED`) o separata per asporto e consegna (`SEPARATE`).
  * Ordini fuori orario o a turno saturo salvati in attesa di riapertura (`awaitingShopOpening`), mai auto-accettati senza approvazione dello staff.
* **Pagamenti Online e alla Consegna:**
  * Integrazione **SumUp Online Payments** (carte di credito/debito e BANCOMAT Pay) con rimborso automatico in caso di rifiuto della comanda da parte del locale.
  * Pagamento in contanti o POS alla consegna/ritiro.
* **Coda Operativa Staff:**
  * Dashboard in tempo reale con notifiche sonore all'arrivo di nuovi ordini (continue per quelli ancora in attesa di apertura).
  * Avanzamento stati: `In attesa (PENDING) → Confermato/In preparazione (CONFIRMED) → Pronto (READY) → Completato (COMPLETED)`, oppure Rifiutato/Annullato con motivo.
  * Numero d'ordine progressivo giornaliero, mostrato su schede, storico e scontrini al posto del nome a partire dalla scheda "In preparazione".
  * In preparazione: tap sulle singole righe prodotto per segnare cosa è già pronto (con tap multipli per le quantità maggiori di uno), e timer di ritardo rispetto all'orario previsto — giallo negli ultimi 15 minuti, rosso e pulsante "Ritardo" lampeggiante se l'ordine è in ritardo.
  * Schede "Completati" e "Rifiutati/Annullati" mostrano solo le ultime 3 ore, con link diretto allo storico completo per tutto il resto.
  * Proposta di modifica orario con invio link di conferma rapido al cliente.
  * Tasto rapido **Naviga** per avviare Google Maps direttamente sulle coordinate di consegna del cliente (solo sulla scheda "Pronti", accanto al completamento).
  * Stampa scontrini PDF: comanda cucina (senza prezzi) e scontrino completo con dati cliente/pagamento/totale in grassetto e dicitura "Comanda - Non Fiscale".
  * Sincronizzazione automatica con **Loyverse POS** alla chiusura della comanda.

### 2. Prenotazioni Tavoli Online
* Widget pubblico per prenotazione tavoli con selezione data, turno (pranzo / cena) e orario a blocchi di 15 minuti, vincolato agli orari di apertura e alla capienza del locale (anticipo minimo configurabile).
* Gestione tavoli con assegnazione anche a più tavoli insieme, tavoli occupati nascosti dalla selezione, overbooking configurabile (illimitato o soglia di posti extra) e coda "senza tavolo" per le richieste da assegnare a mano.
* Creazione manuale di una prenotazione da parte dello staff, con ricerca cliente già in anagrafica.
* Proposta/conferma di un nuovo orario (sia da admin che self-service entro 15 minuti dalla prenotazione) con notifica al cliente.
* Notifiche email automatiche di conferma, proposta cambio orario o rifiuto con motivazione, con link diretto Accetta/Rifiuta per il locale.

### 3. Clienti & CRM Unificato
* Anagrafica clienti unificata alimentata in automatico da ordini online e prenotazioni, con deduplica per email/telefono (anche retroattiva).
* Consenso marketing esplicito e pagina pubblica "gestisci i tuoi dati" per revocarlo o eliminare la propria scheda cliente in autonomia.
* Statistiche per cliente: numero prenotazioni, numero ordini online, spesa totale cumulata e data ultima interazione.
* Import/export xlsx dell'anagrafica, con paginazione e ricerca nell'elenco.
* **Marketing/Comunicazioni:** wizard in 3 passi (tipo comunicazione/promozione → destinatari → contenuto) per inviare email a tutti i clienti o a una selezione, con editor di testo ricco, placeholder sui campi del cliente (nome, cognome, email) e un pulsante opzionale di invito all'azione (call to action) con link esterno.
* **Storico comunicazioni:** esito di invio per singolo destinatario (inviata/fallita/in coda), **tracciamento apertura email** e **tracciamento click sul pulsante CTA**, con il contenuto dell'email sempre rileggibile e i destinatari raggruppati per stato.

### 4. Menù Digitale & QR Code
* Catalogo piatti e bevande per categorie (riordinabili via drag&drop, con visibilità attivabile/disattivabile), con allergeni, foto in alta risoluzione (con ritaglio prima dell'upload), varianti e gruppi di modificatori/aggiunte.
* Disponibilità oraria per turno (pranzo/cena, decoupled dagli orari generali) e marcatura temporanea di esaurito (*unavailable until*).
* Sincronizzazione opzionale del catalogo con **Loyverse POS** (categorie, voci, varianti, modificatori), con blocco delle modifiche manuali sui campi sincronizzati.
* Import/export xlsx del catalogo e del menù online.
* Visualizzazione pubblica ottimizzata per dispositivi mobili via QR al tavolo, con copertina, logo del locale, tema personalizzato e footer con indirizzo/città/contatti.

### 5. Dipendenti & Presenze
* Timbratura entrate/uscite tramite QR code univoco per postazione, tag NFC o geofencing GPS — metodi abilitabili singolarmente dall'admin, con verifica automatica di validità.
* Autosegnalazione "Ho dimenticato di timbrare" con coda di revisione e approvazione/rifiuto da parte di admin/responsabile.
* Gestione richieste assenza (ferie, permessi, malattia) con creazione anche da parte dell'admin per un dipendente, controllo sovrapposizioni e notifiche email di richiesta/decisione.
* Anagrafiche dipendenti con permessi granulari per modulo (quali sezioni può vedere ciascun dipendente, oltre al ruolo Admin/Manager/Dipendente).
* Storico timbrature con filtri per dipendente/data, durata turno calcolata e totali, esportabile in Excel e PDF; storico personale consultabile anche dal dipendente stesso (se abilitato dall'admin), con purga automatica configurabile.

### 6. Controlli (HACCP)
* Registrazione quotidiana delle temperature di frigoriferi, celle e pozzetti, con soglie e alert sui valori fuori norma.
* Schede di pulizia e sanificazione periodica degli ambienti.
* Stampa report HACCP periodici (firmati automaticamente con i dati dell'account autenticato) via PDF o stampa termica su stampanti ESC/POS Epson di rete.

### 7. Inventario & Ordini Fornitori
* Gestione prodotti, scorte minime, unità/quantità per confezione e fornitori con giorni di consegna dedicati.
* Calcolo automatico della lista della spesa in base ai consumi e alle giacenze minime, con apertura del nuovo ordine per fornitore o per categoria (con split automatico).
* Invio ordini ai fornitori via email con allegato PDF e generazione checklist di carico merci.
* Import/export xlsx del catalogo prodotti.
* Generazione diretta di una scadenza di pagamento (modulo Attività) da un ordine fornitore concluso.

### 8. Attività & Spese
* Scadenze operative ricorrenti (giornaliere/settimanali/mensili/annuali) con notifiche email: visite mediche, attestati HACCP/sicurezza, manutenzioni macchinari, scadenze fiscali, pagamenti.
* Storico delle attività completate, separato dalla coda attiva.
* Registrazione spese con metodi di pagamento e portafogli configurabili, filtri, totali e stampa; collegamento diretto tra un'attività di pagamento e la spesa registrata al suo completamento.

### 9. Bacheca & Knowledge Base
* **Bacheca:** messaggi/avvisi interni per tutto il personale, con foto (ritagliabile prima dell'upload), possibilità di fissare in alto i messaggi più importanti e zoom sulle immagini.
* **KBpedia:** knowledge base interna con editor di testo ricco per procedure operative, ricette standard e manuali di sala/cucina, con immagini, brevi video e allegati (PDF, documenti Office) incorporabili negli articoli.

### 10. Impostazioni Locale & Multi-tenant
* Orari di apertura settimanali (pranzo/cena) con aperture speciali per singole date, tema con colore di accento personalizzabile (preset o colore libero) applicato a barra, pulsanti e icone, logo del locale per menù pubblico ed email.
* Dati azienda per menù pubblico ed email (nome, città, indirizzo, telefono, partita IVA) e gestione stampanti di rete multiple (POS ESC/POS Epson), con stampa di prova.
* **Super Admin** multi-locale: creazione/attivazione/disattivazione dei locali, ciascuno isolato sul proprio sotto-dominio e con dati completamente separati dagli altri.
* Pagina "Il mio profilo" per ogni utente: dati propri e cambio password in autonomia, accessibile dall'icona utente nella barra superiore.

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
