import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Video incorporato nel testo dell'articolo: un tag <video> nativo, senza
 * bisogno di JavaScript per essere riprodotto — funziona anche quando
 * l'HTML salvato viene mostrato al di fuori dell'editor (pagina di lettura).
 */
export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, { controls: 'true', style: 'max-width:100%' }),
    ];
  },
});
