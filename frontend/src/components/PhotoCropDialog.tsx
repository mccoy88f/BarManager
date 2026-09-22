import { useCallback, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Box } from '@mui/material';
import Cropper, { Area } from 'react-easy-crop';

interface PhotoCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

/** Le foto vengono poi mostrate solo come miniatura o anteprima ingrandita: non serve salvarle alla risoluzione originale della fotocamera. */
const MAX_OUTPUT_DIMENSION = 1000;

async function getCroppedBlob(imageSrc: string, cropPixels: Area): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  const scale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(cropPixels.width, cropPixels.height));
  const outputWidth = Math.round(cropPixels.width * scale);
  const outputHeight = Math.round(cropPixels.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponibile');

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Ritaglio fallito'))), 'image/jpeg', 0.85);
  });
}

/** Ritaglio 4:3 della foto prima dell'upload, con anteprima e zoom. */
export function PhotoCropDialog({ open, imageSrc, onCancel, onConfirm }: PhotoCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Ritaglia foto</DialogTitle>
      <DialogContent>
        <Box sx={{ position: 'relative', width: '100%', height: 320, bgcolor: 'black' }}>
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={4 / 3}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </Box>
        <Slider
          value={zoom}
          min={1}
          max={3}
          step={0.05}
          onChange={(_e, value) => setZoom(value as number)}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onCancel} disabled={saving}>
          Annulla
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={saving || !croppedAreaPixels}>
          Usa questa foto
        </Button>
      </DialogActions>
    </Dialog>
  );
}
