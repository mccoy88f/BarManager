import { Dialog, DialogTitle, DialogContent, IconButton, Stack } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';

interface PdfViewerDialogProps {
  file: { url: string; filename: string } | null;
  onClose: () => void;
}

/**
 * Anteprima PDF dentro l'app via <iframe>: un link "target=_blank" verso il
 * file grezzo lascia a volte una scheda vuota (browser/webview senza
 * visualizzatore PDF integrato attivo, comune su mobile), mentre l'iframe
 * incorporato in pagina è reso in modo affidabile dai motori dei browser
 * principali indipendentemente da quel comportamento.
 */
export function PdfViewerDialog({ file, onClose }: PdfViewerDialogProps) {
  return (
    <Dialog open={!!file} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
        {file?.filename}
        <Stack direction="row" spacing={0.5}>
          {file && (
            <IconButton component="a" href={file.url} download={file.filename} title="Scarica">
              <DownloadIcon />
            </IconButton>
          )}
          <IconButton onClick={onClose} title="Chiudi">
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {file && <iframe src={file.url} title={file.filename} style={{ width: '100%', height: '100%', border: 'none' }} />}
      </DialogContent>
    </Dialog>
  );
}
