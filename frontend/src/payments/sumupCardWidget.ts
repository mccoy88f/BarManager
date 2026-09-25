/**
 * Caricamento e montaggio del Web Payment Widget di SumUp (Card Widget v2,
 * §5.10 di DEVELOPMENT.md): raccoglie i dati di carta del cliente nel
 * checkout pubblico `/ordina` senza che BarManager li veda mai — il widget
 * gira in un iframe di SumUp, noi passiamo solo il `checkoutId` già creato
 * lato server (`POST /v0.1/checkouts`, v. sumup-client.ts nel backend).
 *
 * NOTA: integrazione da verificare contro l'ambiente sandbox SumUp reale
 * prima del rilascio (nessuna chiave/ambiente di test disponibile in
 * questa sessione) — in particolare la forma esatta dei parametri di
 * `mount`/`onResponseCallback`, qui implementata secondo la documentazione
 * pubblica del Card Widget SumUp.
 */

const SDK_URL = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';

export interface SumUpCardResponse {
  status?: string;
  message?: string;
  [key: string]: unknown;
}

interface SumUpCardMountConfig {
  id: string;
  checkoutId: string;
  onResponseCallback: (resultCode: 'success' | 'error' | string, data: SumUpCardResponse) => void;
  showSubmitButton?: boolean;
  showFooter?: boolean;
  locale?: string;
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
  onResponseCallback: SumUpCardMountConfig['onResponseCallback'],
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
    showSubmitButton: true,
    showFooter: true,
    onResponseCallback,
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
