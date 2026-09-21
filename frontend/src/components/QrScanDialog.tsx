import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import jsQR from 'jsqr';

interface QrScanDialogProps {
  open: boolean;
  onClose: () => void;
  /** Il testo letto dal QR, già ridotto al solo token (vedi extractQrToken). */
  onScan: (qrToken: string) => void;
}

/** Riduce il testo di un QR (URL tipo .../clock/{token}, o il token nudo) al solo token. */
function extractQrToken(scanned: string): string {
  try {
    const url = new URL(scanned);
    const match = url.pathname.match(/\/clock\/([^/]+)\/?$/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // non è un URL assoluto: prova comunque a cercare "/clock/<token>" nel testo
  }
  const match = scanned.match(/\/clock\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : scanned.trim();
}

/** Apre la fotocamera e legge un QR di postazione, senza uscire dall'app. */
export function QrScanDialog({ open, onClose, onScan }: QrScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);

    const stop = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (result?.data) {
        stop();
        onScan(extractQrToken(result.data));
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        frameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Impossibile accedere alla fotocamera: controlla i permessi del browser.');
        }
      });

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Inquadra il QR della postazione</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              bgcolor: 'black',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>Annulla</Button>
      </DialogActions>
    </Dialog>
  );
}
