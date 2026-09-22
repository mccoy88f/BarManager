import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Stack, Tooltip } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import ImageIcon from '@mui/icons-material/Image';
import LinkIcon from '@mui/icons-material/Link';
import { api } from '../api/client';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

/**
 * Editor di testo ricco minimale (contentEditable + execCommand): grassetto,
 * corsivo, sottolineato, elenchi, link, e inserimento di immagini/video
 * caricati su /kb/media e incorporati direttamente nel testo.
 *
 * Il div non è "controllato" da React ad ogni battuta (dangerouslySetInnerHTML
 * ad ogni render sposterebbe il cursore): il contenuto si imposta a mano
 * solo quando `value` cambia dall'esterno (es. caricamento di un articolo
 * esistente), non mentre l'utente sta scrivendo.
 */
export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (
      editorRef.current &&
      value !== lastValueRef.current &&
      document.activeElement !== editorRef.current
    ) {
      editorRef.current.innerHTML = value;
      lastValueRef.current = value;
    }
  }, [value]);

  const notifyChange = () => {
    const html = editorRef.current?.innerHTML ?? '';
    lastValueRef.current = html;
    onChange(html);
  };

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    notifyChange();
  };

  const insertLink = () => {
    const url = window.prompt('Indirizzo del link (https://...)');
    if (url) exec('createLink', url);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<{ url: string; kind: 'image' | 'video' }>(
        '/kb/media',
        form,
      );
      editorRef.current?.focus();
      const html =
        data.kind === 'video'
          ? `<video src="${data.url}" controls style="max-width:100%"></video><br/>`
          : `<img src="${data.url}" style="max-width:100%" /><br/>`;
      document.execCommand('insertHTML', false, html);
      notifyChange();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <Tooltip title="Grassetto">
          <IconButton size="small" onClick={() => exec('bold')}>
            <FormatBoldIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Corsivo">
          <IconButton size="small" onClick={() => exec('italic')}>
            <FormatItalicIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Sottolineato">
          <IconButton size="small" onClick={() => exec('underline')}>
            <FormatUnderlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Elenco puntato">
          <IconButton size="small" onClick={() => exec('insertUnorderedList')}>
            <FormatListBulletedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Elenco numerato">
          <IconButton size="small" onClick={() => exec('insertOrderedList')}>
            <FormatListNumberedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Link">
          <IconButton size="small" onClick={insertLink}>
            <LinkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Inserisci immagine o video">
          <IconButton
            size="small"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <CircularProgress size={16} /> : <ImageIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </Stack>
      <Box
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={notifyChange}
        onBlur={notifyChange}
        sx={{
          minHeight: 240,
          maxHeight: 480,
          overflowY: 'auto',
          p: 2,
          outline: 'none',
          '& img, & video': { maxWidth: '100%' },
        }}
      />
    </Box>
  );
}
