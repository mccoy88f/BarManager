import { Dialog, DialogContent } from '@mui/material';

interface ImageLightboxProps {
  src: string | null;
  onClose: () => void;
}

/** Modale che mostra un'immagine ingrandita: passare `src` per aprirla, `null` per chiuderla. */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={!!src} onClose={onClose} maxWidth="lg">
      <DialogContent sx={{ p: 0, display: 'flex', lineHeight: 0 }}>
        {src && (
          <img src={src} alt="" style={{ width: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
