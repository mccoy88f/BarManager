import { Dialog, DialogContent, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface ImageLightboxProps {
  src: string | null;
  onClose: () => void;
}

/** Modale che mostra un'immagine ingrandita: passare `src` per aprirla, `null` per chiuderla. */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={!!src} onClose={onClose} maxWidth="lg">
      <DialogContent sx={{ p: 0, display: 'flex', lineHeight: 0, position: 'relative' }}>
        <IconButton
          onClick={onClose}
          title="Chiudi"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.5)',
            color: 'white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
          }}
        >
          <CloseIcon />
        </IconButton>
        {src && (
          <img src={src} alt="" style={{ width: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
