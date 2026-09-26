/**
 * Client minimale per la SumUp Online Payments API (Hosted Checkout /
 * Payment Widget, §5.10 di DEVELOPMENT.md — non la Cloud API per lettore
 * fisico, scartata). Ogni locale ha la propria API key (creata dal
 * proprio Dashboard SumUp -> Developer Settings), sempre cifrata come il
 * token Loyverse (v. common/crypto/secret-crypto.ts), mai in chiaro.
 *
 * Il webhook di SumUp è volutamente minimale ({event_type, id}): bisogna
 * sempre rileggere lo stato reale con getCheckout, non fidarsi del solo
 * arrivo della notifica.
 */

const BASE_URL = 'https://api.sumup.com/v0.1';

export class SumUpApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface SumUpCheckout {
  id: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  checkout_reference: string;
  amount: number;
  currency: string;
  transactions?: { id: string; status: string }[];
}

async function callSumUp<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SumUpApiError('API key SumUp non valida o senza i permessi necessari.', res.status);
  }
  if (res.status === 429) {
    throw new SumUpApiError('Limite di richieste SumUp superato: riprova tra qualche minuto.', res.status);
  }
  if (!res.ok) {
    // Il corpo della risposta di SumUp (es. {"message": "...", "error_code": "..."})
    // è l'unico modo per capire *perché* un 400 viene rifiutato (account non
    // abilitato ai pagamenti online, campo mancante, valuta non supportata,
    // ...): senza includerlo qui il log resta un 400 muto e indiagnosticabile.
    // Il body va loggato per intero: il campo "message" di SumUp è spesso
    // solo un'etichetta generica ("Validation error") mentre il motivo vero
    // sta in "error_code"/"param"/altri campi che variano per endpoint —
    // scegliere un singolo campo qui aveva già nascosto l'informazione utile.
    const bodyText = await res.text().catch(() => '');
    throw new SumUpApiError(`SumUp ha risposto con errore ${res.status}${bodyText ? `: ${bodyText}` : '.'}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const sumupClient = {
  /** Crea un checkout per l'importo totale dell'ordine. */
  async createCheckout(
    apiKey: string,
    input: { checkoutReference: string; amount: number; currency: string; description: string },
  ): Promise<SumUpCheckout> {
    return callSumUp<SumUpCheckout>(apiKey, '/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        checkout_reference: input.checkoutReference,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
      }),
    });
  },

  /** Rilegge lo stato reale del checkout — mai fidarsi del solo webhook. */
  async getCheckout(apiKey: string, checkoutId: string): Promise<SumUpCheckout> {
    return callSumUp<SumUpCheckout>(apiKey, `/checkouts/${checkoutId}`);
  },

  /**
   * Verifica solo che la API key sia valida (nessun checkout creato,
   * nessun effetto collaterale): legge il profilo del merchant, che
   * richiede solo un token con permessi minimi ma valido.
   */
  async verifyApiKey(apiKey: string): Promise<void> {
    await callSumUp<unknown>(apiKey, '/me');
  },

  /** Rimborso pieno di una transazione — usato se un ordine pagato viene poi rifiutato. */
  async refund(apiKey: string, transactionId: string): Promise<void> {
    await callSumUp<void>(apiKey, `/me/refund/${transactionId}`, { method: 'POST' });
  },
};
