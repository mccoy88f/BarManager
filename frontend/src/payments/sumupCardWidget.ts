/**
 * Caricamento e montaggio del Web Payment Widget di SumUp (Card Widget v2,
 * §5.10 di DEVELOPMENT.md): raccoglie i dati di carta del cliente nel
 * checkout pubblico `/ordina` senza che BarManager li veda mai — il widget
 * gira in un iframe di SumUp, noi passiamo solo il `checkoutId` già creato
 * lato server (`POST /v0.1/checkouts`, v. sumup-client.ts nel backend).
 *
 * SDK ufficiale (developer.sumup.com/online-payments/checkouts/card-widget),
 * verificato via ricerca web prima di questa versione — non solo dedotto
 * dalla memoria di training: `SumUpCard.mount({id, checkoutId, onResponse,
 * locale, showFooter, currency})`, callback `onResponse(type, body)` con
 * `type` uno tra `sent`/`invalid`/`error`/`success` (non solo successo/
 * errore), e `SumUpCard.unmount(id)` per lo smontaggio pulito. Resta da
 * verificare in sandbox SumUp reale (nessuna credenziale disponibile in
 * questa sessione), ma il contratto qui sotto è quello documentato, non
 * inventato.
 */

const SDK_URL = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';

export interface SumUpCardResponse {
  transaction_id?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * `sent`: form inviato al server, in attesa di risposta (solo informativo).
 * `invalid`: errori di validazione lato client (il widget mostra già i suoi).
 * `error`: il server ha risposto con un errore.
 * `success`: pagamento riuscito.
 */
export type SumUpCardResponseType = 'sent' | 'invalid' | 'error' | 'success';

interface SumUpCardMountConfig {
  id: string;
  checkoutId: string;
  onResponse: (type: SumUpCardResponseType, body: SumUpCardResponse) => void;
  locale?: string;
  showFooter?: boolean;
  currency?: string;
}

interface SumUpCardGlobal {
  mount: (config: SumUpCardMountConfig) => void;
  unmount: (id: string) => void;
}

function sumUpCardGlobal(): SumUpCardGlobal | undefined {
  return (window as unknown as { SumUpCard?: SumUpCardGlobal }).SumUpCard;
}

let sdkPromise: Promise<void> | null = null;

/** Carica lo script SumUp una sola volta per pagina, condiviso da eventuali montaggi successivi. */
function loadSumUpSdk(): Promise<void> {
  if (sumUpCardGlobal()) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Impossibile caricare il modulo di pagamento SumUp.'));
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/** Monta il widget carta SumUp nell'elemento con id `elementId` (deve già esistere nel DOM). */
export async function mountSumUpCard(
  elementId: string,
  checkoutId: string,
  onResponse: SumUpCardMountConfig['onResponse'],
): Promise<void> {
  await loadSumUpSdk();
  const sumUpCard = sumUpCardGlobal();
  if (!sumUpCard) {
    throw new Error('Modulo di pagamento SumUp non disponibile.');
  }
  sumUpCard.mount({
    id: elementId,
    checkoutId,
    locale: 'it-IT',
    showFooter: true,
    currency: 'EUR',
    onResponse,
  });
}

/** Smonta il widget, da chiamare alla chiusura del dialog di pagamento (checkout annullato o completato). */
export function unmountSumUpCard(elementId: string): void {
  try {
    sumUpCardGlobal()?.unmount(elementId);
  } catch {
    // Il widget potrebbe non essere mai stato montato con successo: non bloccare la chiusura del dialog.
  }
}
