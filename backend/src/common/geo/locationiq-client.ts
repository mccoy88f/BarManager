/**
 * Client minimale per LocationIQ (geocodifica diretta/inversa, §5.10 di
 * DEVELOPMENT.md): piano gratuito con uso commerciale esplicitamente
 * permesso, API compatibile Nominatim/OSM. Chiave a livello di
 * piattaforma (LOCATIONIQ_API_KEY), non per singolo locale: non è un
 * account del locale ma un servizio di utilità che BarManager consuma
 * per conto di qualsiasi locale — a differenza di Loyverse/SumUp.
 */

const BASE_URL = 'https://us1.locationiq.com/v1';

export class LocationIqApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

function getApiKey(): string {
  const key = process.env.LOCATIONIQ_API_KEY;
  if (!key) {
    throw new LocationIqApiError('LOCATIONIQ_API_KEY non impostata: necessaria per la geocodifica.');
  }
  return key;
}

async function callLocationIq(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('key', getApiKey());
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new LocationIqApiError('Chiave LocationIQ non valida.', res.status);
  }
  if (res.status === 429) {
    throw new LocationIqApiError(
      'Limite di richieste LocationIQ superato: riprova tra qualche minuto.',
      res.status,
    );
  }
  if (res.status === 404) {
    return null; // nessun risultato, non un errore
  }
  if (!res.ok) {
    throw new LocationIqApiError(`LocationIQ ha risposto con errore ${res.status}.`, res.status);
  }
  return res.json();
}

export const locationIqClient = {
  /** Indirizzo testuale -> coordinate. Null se l'indirizzo non è stato trovato. */
  async forwardGeocode(address: string): Promise<GeocodeResult | null> {
    const body = await callLocationIq('/search.php', { q: address });
    const first = Array.isArray(body) ? body[0] : null;
    if (!first) return null;
    return {
      lat: Number(first.lat),
      lng: Number(first.lon),
      displayName: first.display_name,
    };
  },

  /** Coordinate -> indirizzo leggibile. Null se non risolvibile. */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
    const body = await callLocationIq('/reverse.php', { lat: String(lat), lon: String(lng) });
    if (!body || !body.display_name) return null;
    return {
      lat: Number(body.lat),
      lng: Number(body.lon),
      displayName: body.display_name,
    };
  },
};
