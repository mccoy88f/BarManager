import { useState } from 'react';
import {
  Alert,
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
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface NfcTagRow {
  id: string;
  label: string;
  value: string;
  active: boolean;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Tag NFC per la timbratura: ogni tag va scritto con un'app di scrittura NFC
 * (es. NFC Tools) col testo mostrato qui — BarManager non scrive sui tag,
 * solo li legge al momento della timbratura.
 */
export function NfcTags() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NfcTagRow | null>(null);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<NfcTagRow | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['nfc-tags'],
    queryFn: async () => (await api.get<NfcTagRow[]>('/attendance/nfc-tags')).data,
  });

  const saveTagMutation = useMutation({
    mutationFn: async () => {
      const payload = { label: newTagLabel.trim(), value: newTagValue.trim() };
      return editing
        ? (await api.patch(`/attendance/nfc-tags/${editing.id}`, payload)).data
        : (await api.post('/attendance/nfc-tags', payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nfc-tags'] });
      showToast(editing ? 'Tag NFC aggiornato' : 'Tag NFC creato');
      setNewTagLabel('');
      setNewTagValue('');
      setTagError(null);
      setOpen(false);
      setEditing(null);
    },
    onError: (err) => setTagError(extractErrorMessage(err)),
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/attendance/nfc-tags/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nfc-tags'] });
      setTagToDelete(null);
      showToast('Tag NFC eliminato');
    },
  });

  const openDialog = () => {
    setEditing(null);
    setNewTagLabel('');
    setNewTagValue('');
    setTagError(null);
    setOpen(true);
  };

  const openEdit = (tag: NfcTagRow) => {
    setEditing(tag);
    setNewTagLabel(tag.label);
    setNewTagValue(tag.value);
    setTagError(null);
    setOpen(true);
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Tag NFC</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openDialog}>
          Aggiungi
        </Button>
      </Box>

      <Stack spacing={1}>
        {tagsQuery.data?.map((tag) => (
          <Card key={tag.id} variant="outlined">
            <CardContent
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {tag.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {tag.value}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <IconButton size="small" title="Modifica" onClick={() => openEdit(tag)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" title="Elimina" onClick={() => setTagToDelete(tag)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {tagsQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun tag NFC censito.
          </Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica tag NFC' : 'Nuovo tag NFC'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Scegli un'etichetta e un testo per il tag, poi scrivi lo stesso testo sul tag fisico
            con un'app di scrittura NFC (es. NFC Tools).
          </Typography>
          <TextField
            label="Etichetta (es. Ingresso cucina)"
            value={newTagLabel}
            onChange={(e) => setNewTagLabel(e.target.value)}
          />
          <TextField
            label="Testo da scrivere sul tag"
            value={newTagValue}
            onChange={(e) => setNewTagValue(e.target.value)}
          />
          {tagError && <Alert severity="error">{tagError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={
              !newTagLabel.trim() || newTagValue.trim().length < 4 || saveTagMutation.isPending
            }
            onClick={() => saveTagMutation.mutate()}
          >
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!tagToDelete}
        title="Eliminare il tag NFC?"
        message={
          tagToDelete
            ? `"${tagToDelete.label}" verrà eliminato definitivamente. Il tag fisico continuerà a esistere ma non sarà più riconosciuto.`
            : ''
        }
        loading={deleteTagMutation.isPending}
        onCancel={() => setTagToDelete(null)}
        onConfirm={() => tagToDelete && deleteTagMutation.mutate(tagToDelete.id)}
      />
    </Box>
  );
}
