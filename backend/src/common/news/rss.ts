/**
 * Estrazione titoli da un feed RSS 2.0 (es. ANSA) per il ticker "ultim'ora"
 * di Display Promo (§5.12 di DEVELOPMENT.md): niente libreria di parsing
 * XML in più, un feed RSS è semplice abbastanza da leggere i soli titoli
 * con regex mirate — non costruiamo un DOM, non ci serve altro dal feed.
 *
 * Cache in memoria per URL (15 minuti, stesso intervallo suggerito per il
 * polling): più schermi/locali diversi che puntano allo stesso feed, o lo
 * stesso schermo che fa polling ogni minuto, non devono martellare la
 * fonte esterna a ogni richiesta.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; headlines: string[] }>();

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#8217': '’',
  '#8216': '‘',
  '#8220': '“',
  '#8221': '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, code) => ENTITIES[code] ?? match);
}

function stripCdata(text: string): string {
  const match = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : text;
}

/** Primi N titoli `<title>` dentro ciascun `<item>` del feed, nell'ordine in cui compaiono. */
function extractTitles(xml: string, limit: number): string[] {
  const titles: string[] = [];
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const item of items) {
    if (titles.length >= limit) break;
    const end = item.indexOf('</item>');
    const block = end >= 0 ? item.slice(0, end) : item;
    const match = block.match(/<title>([\s\S]*?)<\/title>/i);
    if (!match) continue;
    const title = decodeEntities(stripCdata(match[1]).trim());
    if (title) titles.push(title);
  }
  return titles;
}

/**
 * Non lancia mai: un feed irraggiungibile/malformato torna un elenco
 * vuoto, mai un errore visibile sullo schermo pubblico (§5.12, resilienza
 * richiesta esplicitamente per questo widget).
 */
export async function fetchHeadlines(feedUrl: string, limit = 20): Promise<string[]> {
  const cached = cache.get(feedUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.headlines;

  try {
    const response = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const headlines = extractTitles(xml, limit);
    cache.set(feedUrl, { fetchedAt: Date.now(), headlines });
    return headlines;
  } catch {
    // Meglio un ticker vuoto (o con l'ultimo elenco buono in cache, anche
    // scaduto) che un errore a schermo su un display pubblico incustodito.
    return cached?.headlines ?? [];
  }
}
