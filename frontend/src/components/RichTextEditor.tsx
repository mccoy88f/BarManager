import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Stack, Tooltip } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import ImageIcon from '@mui/icons-material/Image';
import VideocamIcon from '@mui/icons-material/Videocam';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import LinkIcon from '@mui/icons-material/Link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { api } from '../api/client';
import { VideoNode } from './richtext/VideoNode';
import { AttachmentNode } from './richtext/AttachmentNode';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

/** Metodi richiamabili da un genitore tramite ref, es. per inserire un placeholder alla posizione del cursore (v. pagina Marketing). */
export interface RichTextEditorHandle {
  insertText: (text: string) => void;
}

const ATTACHMENT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Editor di testo ricco basato su Tiptap (licenza MIT, ProseMirror sotto il
 * cofano): grassetto, corsivo, sottolineato, elenchi, link, e inserimento di
 * immagini/video/allegati (es. PDF) caricati sul server e incorporati nel
 * testo — visualizzabili/scaricabili anche nella pagina di lettura.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { value, onChange },
  ref,
) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image,
      VideoNode,
      AttachmentNode,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      editor?.chain().focus().insertContent(text).run();
    },
  }));

  // Il div dell'editor non è "controllato" da React: il contenuto si
  // imposta a mano solo quando `value` cambia dall'esterno (es. caricamento
  // di un articolo esistente), non mentre l'utente sta scrivendo — altrimenti
  // ogni battuta sposterebbe il cursore all'inizio.
  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  const uploadFile = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<{ url: string; kind: string }>('/kb/media', form);
    return data;
  };

  const handleImage = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      editor?.chain().focus().setImage({ src: url }).run();
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleVideo = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      editor?.chain().focus().insertContent({ type: 'video', attrs: { src: url } }).run();
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const handleAttachment = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      editor
        ?.chain()
        .focus()
        .insertContent({ type: 'attachment', attrs: { href: url, filename: file.name } })
        .run();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const insertLink = () => {
    const url = window.prompt('Indirizzo del link (https://...)');
    if (url) editor?.chain().focus().setLink({ href: url }).run();
  };

  if (!editor) return null;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <Tooltip title="Grassetto">
          <IconButton
            size="small"
            color={editor.isActive('bold') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <FormatBoldIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Corsivo">
          <IconButton
            size="small"
            color={editor.isActive('italic') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <FormatItalicIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Sottolineato">
          <IconButton
            size="small"
            color={editor.isActive('underline') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <FormatUnderlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Elenco puntato">
          <IconButton
            size="small"
            color={editor.isActive('bulletList') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <FormatListBulletedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Elenco numerato">
          <IconButton
            size="small"
            color={editor.isActive('orderedList') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <FormatListNumberedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Link">
          <IconButton size="small" onClick={insertLink}>
            <LinkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Inserisci immagine">
          <IconButton
            size="small"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploading}
          >
            <ImageIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImage(file);
          }}
        />
        <Tooltip title="Inserisci video">
          <IconButton
            size="small"
            onClick={() => videoInputRef.current?.click()}
            disabled={uploading}
          >
            <VideocamIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleVideo(file);
          }}
        />
        <Tooltip title="Inserisci allegato (PDF, documento)">
          <IconButton
            size="small"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <CircularProgress size={16} /> : <AttachFileIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAttachment(file);
          }}
        />
      </Stack>
      <Box
        onClick={() => editor.chain().focus().run()}
        sx={{
          minHeight: 240,
          maxHeight: 480,
          overflowY: 'auto',
          p: 2,
          cursor: 'text',
          '& .ProseMirror': { outline: 'none' },
          '& img, & video': { maxWidth: '100%' },
          '& p:first-of-type': { mt: 0 },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
});
