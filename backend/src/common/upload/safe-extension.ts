/**
 * Estensione del file salvato su disco derivata dal mimetype già validato
 * dal fileFilter di ciascun upload, non dal nome file originale inviato dal
 * client: quest'ultimo è scelto liberamente da chi invia la richiesta, e
 * usarlo per l'estensione permetterebbe di salvare un file con estensione
 * "immagine" (servito poi da /uploads) contenente in realtà HTML/JS.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export function safeExtension(mimetype: string): string {
  return EXTENSION_BY_MIME[mimetype] ?? '';
}
