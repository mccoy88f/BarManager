/**
 * URL pubblici assoluti di un locale, condivisi da qualunque modulo debba
 * costruirne uno (prenotazioni: pagine di gestione/auto-gestione/privacy;
 * ordini: logo nell'intestazione email) — prima duplicato identico solo in
 * reservations.service.ts, col rischio già visto altrove nel progetto (v.
 * doc di MailService) che un fix in una copia resti dimenticato nell'altra.
 */

interface VenueForPublicUrl {
  slug: string;
}

/**
 * Base pubblica del locale (frontend): usa il sotto-dominio quando
 * ROOT_DOMAIN è configurato (produzione), altrimenti PUBLIC_APP_URL per lo
 * sviluppo locale. Vale anche per asset caricati sotto `/uploads` (es. il
 * logo), perché frontend e backend condividono la stessa origine dietro lo
 * stesso reverse proxy.
 */
export function venuePublicBaseUrl(venue: VenueForPublicUrl): string {
  const rootDomain = process.env.ROOT_DOMAIN;
  return rootDomain
    ? `https://${venue.slug}.${rootDomain}`
    : process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

/** Base + path pubblico del locale. */
export function venuePublicUrl(venue: VenueForPublicUrl, path: string): string {
  return `${venuePublicBaseUrl(venue)}${path}`;
}

/** URL assoluto del logo del locale (Impostazioni locale), per l'intestazione di qualunque email — null se non impostato. */
export function venueLogoAbsoluteUrl(venue: VenueForPublicUrl & { logoUrl: string | null }): string | null {
  return venue.logoUrl ? venuePublicUrl(venue, venue.logoUrl) : null;
}
