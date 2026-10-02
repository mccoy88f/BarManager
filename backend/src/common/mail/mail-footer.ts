import { escapeHtml } from './escape-html';

export interface VenueFooterInfo {
  name: string;
  menuAddress?: string | null;
  city?: string | null;
  menuPhone?: string | null;
  menuInstagramUrl?: string | null;
  menuFacebookUrl?: string | null;
  menuWebsiteUrl?: string | null;
}

/**
 * Footer uniforme per ogni email al cliente (prenotazioni, ordini online,
 * Marketing/Comunicazioni): stessi dati e stesso ordine del footer del
 * menù pubblico e della pagina ordini online (nome, indirizzo — città,
 * telefono/Instagram/Facebook/sito web), più il link "gestisci i tuoi
 * dati personali" quando è disponibile un token privacy. Prima ogni
 * modulo aveva una propria versione quasi identica (solo il link
 * privacy, senza i dati di contatto) — stesso rischio già visto altrove
 * nel progetto (v. doc di MailService) di un fix applicato a una copia e
 * dimenticato nell'altra.
 */
export function buildMailFooter(venue: VenueFooterInfo, privacyUrl?: string | null): { text: string; html: string } {
  const contactLines = [venue.menuAddress, venue.city].filter((v): v is string => !!v?.trim());
  const links = [
    venue.menuPhone ? { label: venue.menuPhone, url: `tel:${venue.menuPhone}` } : null,
    venue.menuInstagramUrl ? { label: 'Instagram', url: venue.menuInstagramUrl } : null,
    venue.menuFacebookUrl ? { label: 'Facebook', url: venue.menuFacebookUrl } : null,
    venue.menuWebsiteUrl ? { label: 'Sito web', url: venue.menuWebsiteUrl } : null,
  ].filter((l): l is { label: string; url: string } => !!l);

  const text = [
    '',
    '---',
    venue.name,
    ...contactLines,
    ...links.map((l) => `${l.label}: ${l.url}`),
    ...(privacyUrl ? [`Gestisci i tuoi dati personali: ${privacyUrl}`] : []),
  ].join('\n');

  const html = [
    `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #ddd;text-align:center;font-size:0.85em;color:#666;">`,
    `<p style="margin:0 0 4px;font-weight:bold;">${escapeHtml(venue.name)}</p>`,
    contactLines.length ? `<p style="margin:0 0 4px;">${escapeHtml(contactLines.join(' — '))}</p>` : '',
    links.length
      ? `<p style="margin:0 0 4px;">${links.map((l) => `<a href="${l.url}" style="color:#666;">${escapeHtml(l.label)}</a>`).join(' · ')}</p>`
      : '',
    privacyUrl
      ? `<p style="margin:8px 0 0;"><a href="${privacyUrl}" style="color:#999;">Gestisci i tuoi dati personali</a></p>`
      : '',
    `</div>`,
  ]
    .filter(Boolean)
    .join('');

  return { text, html };
}
