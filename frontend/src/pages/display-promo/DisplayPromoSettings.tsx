import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';

interface DisplayPromoPlaylist {
  id: string;
  name: string;
}
interface VenueDisplayPromoSettings {
  displayPromoEnabled: boolean;
  displayPromoDefaultPlaylistId: string | null;
}

const NO_PLAYLIST = '__none__';

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Impostazioni del modulo Display Promo (§5.12): attivazione e playlist di default fuori turno. */
export function DisplayPromoSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueDisplayPromoSettings>('/venues/me')).data,
  });

  const playlistsQuery = useQuery({
    queryKey: ['display-promo-playlists'],
    queryFn: async () => (await api.get<DisplayPromoPlaylist[]>('/display-promo/playlists')).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [defaultPlaylistId, setDefaultPlaylistId] = useState(NO_PLAYLIST);

  useEffect(() => {
    if (!venueQuery.data) return;
    setEnabled(venueQuery.data.displayPromoEnabled);
    setDefaultPlaylistId(venueQuery.data.displayPromoDefaultPlaylistId ?? NO_PLAYLIST);
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/display-promo-settings', {
          displayPromoEnabled: enabled,
          displayPromoDefaultPlaylistId: defaultPlaylistId === NO_PLAYLIST ? null : defaultPlaylistId,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-me'] });
      showToast('Impostazioni salvate');
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button startIcon={<ArrowBackIcon />} sx={{ justifySelf: 'flex-start' }} onClick={() => navigate('/display-promo')}>
        Display Promo
      </Button>

      <Typography variant="h5" fontWeight={700}>
        Impostazioni Display Promo
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="Modulo attivo (pagina pubblica /display raggiungibile)"
          />

          <TextField
            select
            label="Playlist di default"
            helperText="Mostrata fuori dai turni pranzo/cena programmati, e per gli slot senza playlist assegnata."
            value={defaultPlaylistId}
            onChange={(e) => setDefaultPlaylistId(e.target.value)}
          >
            <MenuItem value={NO_PLAYLIST}>
              <em>Nessuna (schermo vuoto)</em>
            </MenuItem>
            {playlistsQuery.data?.map((playlist) => (
              <MenuItem key={playlist.id} value={playlist.id}>
                {playlist.name}
              </MenuItem>
            ))}
          </TextField>

          {saveMutation.isError && <Alert severity="error">{extractErrorMessage(saveMutation.error)}</Alert>}

          <Stack direction="row">
            <Button variant="contained" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Salva
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
