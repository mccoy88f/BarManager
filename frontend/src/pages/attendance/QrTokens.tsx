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
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface QrTokenRow {
  id: string;
  token: string;
  label: string;
  active: boolean;
}

function QrTokenCard({
  qrToken,
  onEdit,
  onDelete,
}: {
  qrToken: QrTokenRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="subtitle1" fontWeight={600}>
            {qrToken.label}
          </Typography>
          <IconButton size="small" title="Modifica nome" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" title="Elimina" onClick={onDelete}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
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
  const [editing, setEditing] = useState<QrTokenRow | null>(null);
  const [label, setLabel] = useState('');
  const [tokenToDelete, setTokenToDelete] = useState<QrTokenRow | null>(null);

  const tokensQuery = useQuery({
    queryKey: ['attendance-qr-tokens'],
    queryFn: async () => (await api.get<QrTokenRow[]>('/attendance/qr-tokens')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['attendance-qr-tokens'] });

  const saveMutation = useMutation({
    mutationFn: async () =>
      editing
        ? (await api.patch(`/attendance/qr-tokens/${editing.id}`, { label })).data
        : (await api.post('/attendance/qr-tokens', { label })).data,
    onSuccess: () => {
      invalidate();
      setLabel('');
      setOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/attendance/qr-tokens/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setTokenToDelete(null);
    },
  });

  const openDialog = () => {
    setEditing(null);
    setLabel('');
    setOpen(true);
  };

  const openEdit = (qrToken: QrTokenRow) => {
    setEditing(qrToken);
    setLabel(qrToken.label);
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
            <QrTokenCard
              qrToken={qrToken}
              onEdit={() => openEdit(qrToken)}
              onDelete={() => setTokenToDelete(qrToken)}
            />
          </Box>
        ))}
        {tokensQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessuna postazione QR creata.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica postazione QR' : 'Nuova postazione QR'}</DialogTitle>
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
            disabled={!label || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {editing ? 'Salva' : 'Genera QR'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!tokenToDelete}
        title="Eliminare la postazione QR?"
        message={
          tokenToDelete
            ? `"${tokenToDelete.label}" non sarà più valida per timbrare: il QR stampato smetterà di funzionare. Lo storico delle timbrature già registrate resta consultabile.`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => setTokenToDelete(null)}
        onConfirm={() => tokenToDelete && deleteMutation.mutate(tokenToDelete.id)}
      />
    </Box>
  );
}
