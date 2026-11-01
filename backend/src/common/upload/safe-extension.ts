/**
 * Estensione del file salvato su disco derivata dal mimetype già validato
 * dal fileFilter di ciascun upload, non dal nome file originale inviato dal
 * client: quest'ultimo è scelto liberamente da chi invia la richiesta, e
 * usarlo per l'estensione permetterebbe di salvare un file con estensione
 * "immagine" (servito poi da /uploads) contenente in realtà HTML/JS.
 *
 * Supporta parametri MIME (es. video/mp4; codecs=...), case-insensitivity
 * e un fallback sicuro su estensioni note se mimetype è generico.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/3gpp': '.3gp',
  'video/x-matroska': '.mkv',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export function safeExtension(mimetype?: string, originalName?: string): string {
  if (mimetype) {
    const cleanMime = mimetype.split(';')[0].trim().toLowerCase();
    if (EXTENSION_BY_MIME[cleanMime]) {
      return EXTENSION_BY_MIME[cleanMime];
    }
  }

  if (originalName) {
    const match = originalName.match(/\.(jpe?g|png|webp|gif|svg|mp4|webm|ogv|ogg|mov|m4v|pdf|docx?|xlsx?|pptx?)$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (ext === 'jpeg') return '.jpg';
      if (ext === 'ogg') return '.ogv';
      return `.${ext}`;
    }
  }

  return '';
}
