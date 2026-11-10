/**
 * Tracciato RCH PRINT! F via web service HTTP (`/service.cgi`).
 * Dialetto ufficiale "protocollo RCH / Standard", allineato a
 * epson-fiscal-printer (RCHXmlHttpClient) e alle integrazioni Odoo/Facile.
 *
 * La cassa deve avere ABILITA WEBSERVER = SI (porta tipica 80).
 * v1: una sola riga di vendita "Ordine n. X" con il totale ordine
 * (spese di consegna già incluse), poi chiusura pagamento.
 */

export type RchPaymentLabel = 'Contanti' | 'Carta';

export interface RchFiscalBuildInput {
  /** Descrizione riga vendita (es. "Ordine n. 12" o "Test fiscale"). */
  description: string;
  /** Totale in euro (subtotale + consegna; 0 per il test). */
  total: number;
  department: number;
  paymentIndex: number;
  paymentLabel: RchPaymentLabel;
}

/** Euro → centesimi interi (arrotondamento bancario via Math.round). */
export function toCentesimi(euros: number): number {
  return Math.round(Number(euros) * 100);
}

/**
 * Descrizione riga vendita: max 24 caratteri.
 * Rimuove separatori del dialetto RCH (`( ) /`) e virgolette.
 */
export function sanitizeRchDescription(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[()/"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Articolo').slice(0, 24);
}

/**
 * Comando vendita RCH: `=R<dept>/$<cents>/(DESC)`
 * con quantità: `=R<dept>/$<cents>/*<qty>/(DESC)` (qty omessa se 1).
 */
export function buildSaleCommand(
  description: string,
  quantity: number,
  unitPriceEuros: number,
  department: number,
): string {
  const desc = sanitizeRchDescription(description);
  const cents = toCentesimi(unitPriceEuros);
  const qty = Math.max(1, Math.round(quantity));
  const qtyPart = qty === 1 ? '' : `/*${qty}`;
  return `=R${department}/$${cents}${qtyPart}/(${desc})`;
}

/**
 * Comando pagamento RCH: `=T<index>/$<cents>/(Label)`
 * L'indice è il pulsante programmato in cassa (Contanti, Carta, …).
 */
export function buildPaymentCommand(
  totalEuros: number,
  paymentIndex: number,
  paymentLabel: RchPaymentLabel = 'Contanti',
): string {
  const label = sanitizeRchDescription(paymentLabel);
  return `=T${paymentIndex}/$${toCentesimi(totalEuros)}/(${label})`;
}

/** Una riga di vendita al totale, poi chiusura pagamento. */
export function buildRchFiscalCommands(input: RchFiscalBuildInput): string[] {
  return [
    buildSaleCommand(input.description, 1, input.total, input.department),
    buildPaymentCommand(input.total, input.paymentIndex, input.paymentLabel),
  ];
}

/** Escape minimo per testo dentro elementi XML. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Body XML per POST `http://host:port/service.cgi`.
 * Stesso schema di RCHXmlHttpClient / documentazione Print! F.
 */
export function buildRchFiscalXml(commands: string[]): string {
  const cmds = commands.map((c) => `  <cmd>${escapeXml(c)}</cmd>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Service>\n${cmds}\n</Service>\n`;
}

/** @deprecated alias: ora produce l'XML del web service, non il raw XON/XOFF. */
export function joinRchFiscalPayload(commands: string[]): string {
  return buildRchFiscalXml(commands);
}
