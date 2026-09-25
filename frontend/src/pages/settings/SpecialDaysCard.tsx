import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/ToastProvider';

interface DayOverride {
  closed: boolean;
  slot1Start: string | null;
  slot1End: string | null;
  slot2Start: string | null;
  slot2End: string | null;
}

interface SpecialDay {
  id: string;
  date: string;
  label: string | null;
  realHoursOverride: DayOverride | null;
  menuHoursOverride: DayOverride | null;
}

const emptyOverride: DayOverride = {
  closed: true,
  slot1Start: null,
  slot1End: null,
  slot2Start: null,
  slot2End: null,
};

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Un solo giorno (closed/slot1/slot2), senza "dayOfWeek": usato per sovrascrivere l'orario di una data specifica. */
function DayOverrideFields({
  override,
  onChange,
}: {
  override: DayOverride;
  onChange: (patch: Partial<DayOverride>) => void;
}) {
  const hasSlot2 = override.slot2Start != null && override.slot2End != null;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ rowGap: 1 }}>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={!override.closed}
            onChange={(e) => onChange({ closed: !e.target.checked })}
          />
        }
        label={override.closed ? 'Chiuso' : 'Aperto'}
      />
      {!override.closed && (
        <>
          <TextField
            label="Dalle"
            type="time"
            size="small"
            inputProps={{ step: 900 }}
            InputLabelProps={{ shrink: true }}
            value={override.slot1Start ?? ''}
            onChange={(e) => onChange({ slot1Start: e.target.value })}
          />
          <TextField
            label="Alle"
            type="time"
            size="small"
            inputProps={{ step: 900 }}
            InputLabelProps={{ shrink: true }}
            value={override.slot1End ?? ''}
            onChange={(e) => onChange({ slot1End: e.target.value })}
          />
          {hasSlot2 ? (
            <>
              <TextField
                label="Dalle (2ª fascia)"
                type="time"
                size="small"
                inputProps={{ step: 900 }}
                InputLabelProps={{ shrink: true }}
                value={override.slot2Start ?? ''}
                onChange={(e) => onChange({ slot2Start: e.target.value })}
              />
              <TextField
                label="Alle (2ª fascia)"
                type="time"
                size="small"
                inputProps={{ step: 900 }}
                InputLabelProps={{ shrink: true }}
                value={override.slot2End ?? ''}
                onChange={(e) => onChange({ slot2End: e.target.value })}
              />
              <Button size="small" color="error" onClick={() => onChange({ slot2Start: null, slot2End: null })}>
                Rimuovi 2ª fascia
              </Button>
            </>
          ) : (
            <Button size="small" onClick={() => onChange({ slot2Start: '19:00', slot2End: '23:00' })}>
              + Aggiungi seconda fascia
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Aperture speciali (§5.10 di DEVELOPMENT.md): sovrascrivono per una
 * singola data l'orario reale del locale e/o le fasce pranzo/cena del
 * menù, indipendentemente l'uno dall'altro (es. "chiuso il 25 dicembre",
 * o "aperto più tardi la Vigilia" senza toccare il menù).
 */
export function SpecialDaysCard() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SpecialDay | null>(null);
  const [form, setForm] = useState<{
    date: string;
    label: string;
    realEnabled: boolean;
    real: DayOverride;
    menuEnabled: boolean;
    menu: DayOverride;
  }>({ date: '', label: '', realEnabled: false, real: emptyOverride, menuEnabled: false, menu: emptyOverride });

  const specialDaysQuery = useQuery({
    queryKey: ['venue-special-days'],
    queryFn: async () => (await api.get<SpecialDay[]>('/venues/me/special-days')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['venue-special-days'] });

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/venues/me/special-days', {
          date: form.date,
          label: form.label.trim() || null,
          realHoursOverride: form.realEnabled ? form.real : null,
          menuHoursOverride: form.menuEnabled ? form.menu : null,
        })
      ).data,
    onSuccess: () => {
      invalidate();
      showToast('Apertura speciale salvata');
      setDialogOpen(false);
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/venues/me/special-days/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      showToast('Apertura speciale eliminata');
    },
  });

  const openAddDialog = () => {
    setForm({ date: '', label: '', realEnabled: false, real: emptyOverride, menuEnabled: false, menu: emptyOverride });
    setDialogOpen(true);
  };

  const openEditDialog = (day: SpecialDay) => {
    setForm({
      date: day.date.slice(0, 10),
      label: day.label ?? '',
      realEnabled: !!day.realHoursOverride,
      real: day.realHoursOverride ?? emptyOverride,
      menuEnabled: !!day.menuHoursOverride,
      menu: day.menuHoursOverride ?? emptyOverride,
    });
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6">Aperture speciali</Typography>
            <Typography variant="body2" color="text.secondary">
              Sovrascrivono, solo per una data specifica, l'orario reale e/o le fasce pranzo/cena
              del menù (es. chiusura o orari diversi per una festività).
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openAddDialog}>
            Aggiungi
          </Button>
        </Box>

        {(specialDaysQuery.data?.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Nessuna apertura speciale configurata.
          </Typography>
        ) : (
          <List sx={{ mt: 1 }}>
            {specialDaysQuery.data!.map((day) => (
              <ListItem
                key={day.id}
                disableGutters
                secondaryAction={
                  <IconButton edge="end" color="error" onClick={() => setToDelete(day)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
                onClick={() => openEditDialog(day)}
                sx={{ cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <ListItemText
                  primary={`${formatDate(day.date)}${day.label ? ` — ${day.label}` : ''}`}
                  secondary={
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {day.realHoursOverride && <Chip size="small" label="Orario reale" />}
                      {day.menuHoursOverride && <Chip size="small" variant="outlined" label="Orari menù" />}
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Apertura speciale</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 4 }}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Data"
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
            <TextField
              label="Etichetta (opzionale)"
              placeholder="es. Vigilia di Natale"
              fullWidth
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </Stack>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.realEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, realEnabled: e.target.checked }))}
                />
              }
              label="Sovrascrivi l'orario reale per questa data"
            />
            {form.realEnabled && (
              <Box sx={{ mt: 1 }}>
                <DayOverrideFields override={form.real} onChange={(patch) => setForm((f) => ({ ...f, real: { ...f.real, ...patch } }))} />
              </Box>
            )}
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.menuEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, menuEnabled: e.target.checked }))}
                />
              }
              label="Sovrascrivi le fasce pranzo/cena del menù per questa data"
            />
            {form.menuEnabled && (
              <Box sx={{ mt: 1 }}>
                <DayOverrideFields override={form.menu} onChange={(patch) => setForm((f) => ({ ...f, menu: { ...f.menu, ...patch } }))} />
              </Box>
            )}
          </Box>

          {saveMutation.isError && <Alert severity="error">{extractErrorMessage(saveMutation.error)}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!form.date || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare l'apertura speciale?"
        message={toDelete ? `L'apertura speciale per ${formatDate(toDelete.date)} verrà eliminata.` : ''}
        loading={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Card>
  );
}
