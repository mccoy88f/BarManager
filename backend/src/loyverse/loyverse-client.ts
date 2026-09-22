/**
 * Client minimale per le API pubbliche di Loyverse (https://api.loyverse.com/v1.0).
 *
 * I nomi dei campi qui sotto (item_name, category_id, variant_id,
 * default_price, cursor) vengono da fonti di terze parti (SDK open source,
 * community Loyverse) perché la documentazione ufficiale non è stata
 * raggiungibile durante lo sviluppo: da verificare con un account reale
 * alla prima sincronizzazione vera. Il parsing è scritto in modo
 * defensivo (campi opzionali, niente eccezioni su un campo mancante) così
 * un nome sbagliato degrada a "dato assente", non a un sync che si rompe.
 */

const BASE_URL = 'https://api.loyverse.com/v1.0';

export interface LoyverseCategory {
  id: string;
  name: string;
  deleted_at?: string | null;
}

export interface LoyverseVariant {
  variant_id: string;
  default_price?: number;
  variant_name?: string;
}

export interface LoyverseItem {
  id: string;
  item_name: string;
  category_id?: string | null;
  variants?: LoyverseVariant[];
  deleted_at?: string | null;
  // Nome del campo immagine non confermato: proviamo le varianti più
  // comuni viste in altre API POS.
  image_url?: string;
  images?: { url?: string }[];
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
  return item.image_url || item.images?.[0]?.url || undefined;
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
