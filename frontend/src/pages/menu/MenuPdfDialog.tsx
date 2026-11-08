import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Typography,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useToast } from '../../components/ToastProvider';
import { buildMenuPdf, saveMenuPdf, type MenuPdfCategory, type MenuPdfItem } from './exportMenuPdf';

/**
 * Scelta delle categorie da mettere nel PDF del menù, generato sul dispositivo.
 */
export function MenuPdfDialog({
  open,
  categories,
  items,
  venueName,
  onClose,
}: {
  open: boolean;
  categories: MenuPdfCategory[];
  items: MenuPdfItem[];
  venueName: string;
  onClose: () => void;
}) {
  const showToast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected(categories.map((category) => category.id));
  }, [open, categories]);

  const allSelected = categories.length > 0 && selected.length === categories.length;

  const create = async () => {
    const chosen = categories.filter((category) => selected.includes(category.id));
    const result = buildMenuPdf({ venueName, categories: chosen, items });
    if (!result) {
      showToast({ message: 'Nessun prodotto visibile nelle categorie scelte.', severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await saveMenuPdf(result.blob, result.filename);
      onClose();
    } catch {
      showToast({ message: 'Non è stato possibile creare il PDF.', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Esporta menù PDF</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Scegli le categorie da includere. Nel PDF, per ogni prodotto: il nome, sotto la descrizione e sotto il prezzo. Entrano solo le voci visibili.
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={allSelected}
              indeterminate={selected.length > 0 && !allSelected}
              onChange={(e) => setSelected(e.target.checked ? categories.map((category) => category.id) : [])}
            />
          }
          label="Tutte le categorie"
        />
        <FormGroup sx={{ pl: 1 }}>
          {categories.map((category) => (
            <FormControlLabel
              key={category.id}
              control={
                <Checkbox
                  checked={selected.includes(category.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id),
                    )
                  }
                />
              }
              label={category.name}
            />
          ))}
        </FormGroup>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Annulla
        </Button>
        <Button
          variant="contained"
          startIcon={<PictureAsPdfIcon />}
          disabled={selected.length === 0 || saving}
          onClick={() => void create()}
        >
          Crea PDF
        </Button>
      </DialogActions>
    </Dialog>
  );
}
