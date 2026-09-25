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
  MenuItem as MuiMenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface ModifierOption {
  id: string;
  name: string;
  price: number;
}
interface ModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  minSelections: number;
  maxSelections: number | null;
  options: ModifierOption[];
}
interface OptionForm {
  name: string;
  price: string;
}

const emptyOption: OptionForm = { name: '', price: '0' };

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio del gruppo di modificatori.';
}

/**
 * Gruppi di modificatori (es. "Estras": +Formaggio, -Cipolla — §5.10 di
 * DEVELOPMENT.md): asse ortogonale alle Varianti, condivisibili da più
 * voci di menù diverse. Stesso pattern di array-di-righe con
 * add/remove/update inline già usato per le varianti nel dialog voce di
 * menù, qui applicato alle opzioni di un gruppo.
 */
export function ModifierGroupsCard({ locked }: { locked: boolean }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModifierGroup | null>(null);
  const [name, setName] = useState('');
  const [selectionType, setSelectionType] = useState<'SINGLE' | 'MULTIPLE'>('SINGLE');
  const [minSelections, setMinSelections] = useState('0');
  const [optionForms, setOptionForms] = useState<OptionForm[]>([emptyOption]);
  const [toDelete, setToDelete] = useState<ModifierGroup | null>(null);

  const groupsQuery = useQuery({
    queryKey: ['menu-modifier-groups'],
    queryFn: async () => (await api.get<ModifierGroup[]>('/menu/modifier-groups')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['menu-modifier-groups'] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        selectionType,
        minSelections: Number(minSelections),
        options: optionForms
          .filter((o) => o.name.trim())
          .map((o) => ({ name: o.name.trim(), price: Number(o.price) || 0 })),
      };
      return editing
        ? (await api.patch(`/menu/modifier-groups/${editing.id}`, payload)).data
        : (await api.post('/menu/modifier-groups', payload)).data;
    },
    onSuccess: () => {
      invalidate();
      showToast(editing ? 'Gruppo aggiornato' : 'Gruppo creato');
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/menu/modifier-groups/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast('Gruppo eliminato');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setSelectionType('SINGLE');
    setMinSelections('0');
    setOptionForms([emptyOption]);
    setDialogOpen(true);
  };

  const openEdit = (group: ModifierGroup) => {
    setEditing(group);
    setName(group.name);
    setSelectionType(group.selectionType);
    setMinSelections(String(group.minSelections));
    setOptionForms(
      group.options.length > 0
        ? group.options.map((o) => ({ name: o.name, price: String(o.price) }))
        : [emptyOption],
    );
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const addOptionForm = () => setOptionForms((rows) => [...rows, emptyOption]);
  const removeOptionForm = (index: number) => setOptionForms((rows) => rows.filter((_, i) => i !== index));
  const updateOptionForm = (index: number, patch: Partial<OptionForm>) =>
    setOptionForms((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const canSubmit = name.trim() && optionForms.some((o) => o.name.trim());

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6">Modificatori</Typography>
            <Typography variant="body2" color="text.secondary">
              {locked
                ? 'Sincronizzati da Loyverse: nome e opzioni non modificabili qui (§5.10).'
                : 'Gruppi come "Estras", riusabili su più voci di menù (§5.10)'}
            </Typography>
          </Box>
          {!locked && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Aggiungi
            </Button>
          )}
        </Box>

        <Stack spacing={1} sx={{ mt: 2 }}>
          {groupsQuery.data?.map((group) => (
            <Box
              key={group.id}
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, borderRadius: 1, bgcolor: 'action.hover' }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {group.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.options.map((o) => o.name).join(', ')}
                </Typography>
              </Box>
              {!locked && (
                <Box>
                  <IconButton size="small" title="Modifica" onClick={() => openEdit(group)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" title="Elimina" onClick={() => setToDelete(group)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
            </Box>
          ))}
          {groupsQuery.data?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessun gruppo di modificatori ancora creato.
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifica gruppo di modificatori' : 'Nuovo gruppo di modificatori'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <TextField label="Nome (es. Estras)" value={name} onChange={(e) => setName(e.target.value)} />
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Tipo di selezione"
              fullWidth
              value={selectionType}
              onChange={(e) => setSelectionType(e.target.value as 'SINGLE' | 'MULTIPLE')}
            >
              <MuiMenuItem value="SINGLE">Una sola opzione</MuiMenuItem>
              <MuiMenuItem value="MULTIPLE">Più opzioni insieme</MuiMenuItem>
            </TextField>
            <TextField
              label="Selezioni minime"
              type="number"
              fullWidth
              inputProps={{ min: 0 }}
              helperText="0 = opzionale"
              value={minSelections}
              onChange={(e) => setMinSelections(e.target.value)}
            />
          </Stack>

          <Typography variant="body2" fontWeight={600}>
            Opzioni
          </Typography>
          <Stack spacing={1}>
            {optionForms.map((option, index) => (
              <Stack key={index} direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Nome (es. Formaggio extra)"
                  size="small"
                  value={option.name}
                  onChange={(e) => updateOptionForm(index, { name: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Prezzo (€)"
                  type="number"
                  size="small"
                  inputProps={{ min: 0, step: 0.5 }}
                  value={option.price}
                  onChange={(e) => updateOptionForm(index, { price: e.target.value })}
                  sx={{ width: 120 }}
                />
                {optionForms.length > 1 && (
                  <IconButton size="small" title="Rimuovi opzione" onClick={() => removeOptionForm(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            ))}
          </Stack>
          <Button size="small" startIcon={<AddIcon />} onClick={addOptionForm} sx={{ justifySelf: 'flex-start' }}>
            Aggiungi opzione
          </Button>

          {saveMutation.isError && <Alert severity="error">{extractErrorMessage(saveMutation.error)}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeDialog}>Annulla</Button>
          <Button variant="contained" disabled={!canSubmit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {editing ? 'Salva' : 'Aggiungi'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare il gruppo?"
        message={toDelete ? `"${toDelete.name}" verrà rimosso da tutte le voci di menù a cui è assegnato.` : ''}
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Card>
  );
}
