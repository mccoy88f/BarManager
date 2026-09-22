/**
 * Client minimale per le API pubbliche di Loyverse (https://api.loyverse.com/v1.0).
 *
 * Nomi dei campi verificati contro la documentazione ufficiale
 * (developer.loyverse.com/docs) incollata dall'utente, non più da fonti di
 * terze parti. In particolare: le varianti NON hanno un nome libero
 * ("variant_name" non esiste) — il nome è la combinazione dei valori
 * "option1_value"/"option2_value"/"option3_value" della variante, mentre
 * l'item porta i nomi di quelle opzioni in "option1_name" ecc. Il prezzo
 * "default_price" esiste solo quando "default_pricing_type" della
 * variante è "FIXED"; con "VARIABLE" il prezzo si decide in cassa e non
 * c'è nulla da sincronizzare per quella variante.
 *
 * Ogni variante ha anche uno "stores[]" con override di prezzo per singolo
 * punto vendita ({store_id, pricing_type, price, ...}), volutamente non
 * letto qui: BarManager assume un account Loyverse a punto vendita unico
 * per locale (confermato in fase di analisi), quindi "default_price" è
 * sempre il prezzo giusto da sincronizzare.
 */

const BASE_URL = 'https://api.loyverse.com/v1.0';

export interface LoyverseCategory {
  id: string;
  name: string;
  deleted_at?: string | null;
}

export interface LoyverseVariant {
  variant_id: string;
  default_pricing_type?: 'FIXED' | 'VARIABLE';
  default_price?: number | null;
  option1_value?: string;
  option2_value?: string;
  option3_value?: string;
}

export interface LoyverseItem {
  id: string;
  item_name: string;
  category_id?: string | null;
  variants?: LoyverseVariant[];
  deleted_at?: string | null;
  image_url?: string;
}

/** Nome variante per BarManager: i valori delle opzioni Loyverse uniti (es. "Piccola" o "Piccola, Rosso"). */
export function variantDisplayName(variant: LoyverseVariant): string {
  return [variant.option1_value, variant.option2_value, variant.option3_value]
    .filter((v): v is string => !!v)
    .join(', ');
}

export class LoyverseApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function extractImageUrl(item: LoyverseItem): string | undefined {
  return item.image_url || undefined;
}

async function fetchAllPages<T>(
  accessToken: string,
  path: string,
  itemsKey: string,
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new LoyverseApiError('Token Loyverse non valido o senza i permessi necessari.', res.status);
    }
    if (res.status === 429) {
      throw new LoyverseApiError(
        'Limite di richieste Loyverse superato: riprova la sincronizzazione tra qualche minuto.',
        res.status,
      );
    }
    if (!res.ok) {
      throw new LoyverseApiError(`Loyverse ha risposto con errore ${res.status}.`, res.status);
    }

    const body = await res.json();
    results.push(...(body[itemsKey] ?? []));
    cursor = body.cursor || undefined;
  } while (cursor);

  return results;
}

export const loyverseClient = {
  async listCategories(accessToken: string): Promise<LoyverseCategory[]> {
    return fetchAllPages<LoyverseCategory>(accessToken, '/categories', 'categories');
  },

  async listItems(accessToken: string): Promise<LoyverseItem[]> {
    return fetchAllPages<LoyverseItem>(accessToken, '/items', 'items');
  },

  extractImageUrl,
};
