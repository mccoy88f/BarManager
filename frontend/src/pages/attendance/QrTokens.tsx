import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';

interface QrTokenRow {
  id: string;
  token: string;
  label: string;
  active: boolean;
}

function QrTokenCard({ qrToken }: { qrToken: QrTokenRow }) {
  const [dataUrl, setDataUrl] = useState('');
  const clockUrl = `${window.location.origin}/clock/${qrToken.token}`;

  useEffect(() => {
    QRCode.toDataURL(clockUrl, { width: 280, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [clockUrl]);

  return (
    <Card variant="outlined">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {qrToken.label}
        </Typography>
        {dataUrl && (
          <Box component="img" src={dataUrl} alt={`QR ${qrToken.label}`} sx={{ width: 180, height: 180 }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', textAlign: 'center' }}>
          {clockUrl}
        </Typography>
        {dataUrl && (
          <Button
            size="small"
            variant="outlined"
            component="a"
            href={dataUrl}
            download={`qrcode-${qrToken.label.replace(/\s+/g, '-').toLowerCase()}.png`}
          >
            Scarica QR code
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Postazioni QR per la timbratura: ogni QR punta a /clock/:token, che il
 * dipendente apre già loggato (da app installata o browser) per registrare
 * inizio/fine turno.
 */
export function QrTokens() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');

  const tokensQuery = useQuery({
    queryKey: ['attendance-qr-tokens'],
    queryFn: async () => (await api.get<QrTokenRow[]>('/attendance/qr-tokens')).data,
  });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post('/attendance/qr-tokens', { label })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-qr-tokens'] });
      setLabel('');
      setOpen(false);
    },
  });

  const openDialog = () => {
    setLabel('');
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Postazioni QR</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openDialog}>
          Genera QR
        </Button>
      </Box>

      <Stack direction="row" flexWrap="wrap" gap={2}>
        {tokensQuery.data?.map((qrToken) => (
          <Box key={qrToken.id} sx={{ width: 220 }}>
            <QrTokenCard qrToken={qrToken} />
          </Box>
        ))}
        {tokensQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna postazione QR creata.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nuova postazione QR</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Stampa il QR e affiggilo alla postazione (es. ingresso cucina): i dipendenti lo
            inquadrano per timbrare inizio/fine turno.
          </Typography>
          <TextField
            label="Nome postazione"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!label || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Genera QR
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
