/**
 * Versione solo-testo di un HTML compilato con l'editor ricco (Tiptap):
 * fallback per i client email senza rendering HTML (`MailSendParams.text`,
 * sempre richiesto insieme a `html`). Non è un parser vero, solo quanto
 * basta per il markup che l'editor produce (paragrafi, elenchi, grassetto,
 * link, ...): niente di più sofisticato serve per un fallback testuale.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
