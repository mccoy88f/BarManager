import { Node } from '@tiptap/core';

const CARD_STYLE =
  'display:inline-flex;align-items:center;gap:10px;border:1px solid #ccc;border-radius:8px;padding:6px 12px;margin:4px 0;';
const DOWNLOAD_STYLE = 'font-size:0.85em;';

/**
 * Allegato incorporato nel testo (es. PDF di una procedura): due link nativi
 * — uno per aprirlo/vederlo in una nuova scheda, uno per scaricarlo — così
 * funziona anche fuori dall'editor, sulla pagina di lettura dell'articolo.
 */
export const AttachmentNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null, rendered: false },
      filename: { default: 'Allegato', rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.kb-attachment',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const link = el.querySelector('a[href]');
          if (!link) return false;
          return {
            href: link.getAttribute('href'),
            filename: link.textContent?.trim() || 'Allegato',
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { href, filename } = node.attrs as { href: string; filename: string };
    return [
      'div',
      { class: 'kb-attachment', style: CARD_STYLE },
      ['a', { href, target: '_blank', rel: 'noopener noreferrer' }, filename],
      ['a', { href, download: filename, style: DOWNLOAD_STYLE }, 'Scarica'],
    ];
  },
});
