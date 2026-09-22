import { Dialog, DialogContent, IconButton, Stack } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface ImageLightboxProps {
  src: string | null;
  onClose: () => void;
}

/**
 * Modale che mostra un'immagine ingrandita: passare `src` per aprirla,
 * `null` per chiuderla. Zoom con i pulsanti o pinch-to-zoom su mobile
 * (react-zoom-pan-pinch, come l'anteprima PDF di KBpedia).
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  return (
    <Dialog open={!!src} onClose={onClose} maxWidth="lg" fullWidth>
      <TransformWrapper key={src} minScale={0.5} maxScale={4} centerZoomedOut doubleClick={{ mode: 'toggle' }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <DialogContent sx={{ p: 0, display: 'flex', lineHeight: 0, position: 'relative', height: '85vh' }}>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
            >
              {[
                { icon: <ZoomOutIcon />, title: 'Riduci', onClick: () => zoomOut() },
                { icon: <ZoomInIcon />, title: 'Aumenta', onClick: () => zoomIn() },
                { icon: <RestartAltIcon />, title: 'Adatta alla finestra', onClick: () => resetTransform() },
                { icon: <CloseIcon />, title: 'Chiudi', onClick: onClose },
              ].map(({ icon, title, onClick }) => (
                <IconButton
                  key={title}
                  onClick={onClick}
                  title={title}
                  sx={{
                    bgcolor: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                  }}
                >
                  {icon}
                </IconButton>
              ))}
            </Stack>
            {src && (
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              >
                <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
              </TransformComponent>
            )}
          </DialogContent>
        )}
      </TransformWrapper>
    </Dialog>
  );
}
