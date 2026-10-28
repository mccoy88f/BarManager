import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';

interface VenueDisplayPromoSettings {
  displayPromoEnabled: boolean;
  displayPromoNewsFeedUrl: string | null;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Impostazioni del modulo Display Promo (§5.12): attivazione generale e
 * feed RSS per il ticker notizie (condiviso da tutti i display del
 * locale). La playlist di default, la programmazione e la fascia
 * "orologio/meteo/notizie" sono invece per singolo display (un locale può
 * averne più di uno), gestite nella pagina principale "Display Promo".
 */
export function DisplayPromoSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueDisplayPromoSettings>('/venues/me')).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [newsFeedUrl, setNewsFeedUrl] = useState('');

  useEffect(() => {
    if (!venueQuery.data) return;
    setEnabled(venueQuery.data.displayPromoEnabled);
    setNewsFeedUrl(venueQuery.data.displayPromoNewsFeedUrl ?? '');
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch('/venues/me/display-promo-settings', {
          displayPromoEnabled: enabled,
          displayPromoNewsFeedUrl: newsFeedUrl.trim() || null,
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
            label="Modulo attivo (pagine pubbliche /display/:id raggiungibili)"
          />

          <TextField
            label="Feed RSS notizie (es. ANSA)"
            placeholder="https://www.ansa.it/sito/ansait_rss.xml"
            helperText={'Usato per il ticker "ultim\'ora" sui display che hanno attivato la fascia orologio/meteo/notizie. Vuoto = nessun ticker.'}
            value={newsFeedUrl}
            onChange={(e) => setNewsFeedUrl(e.target.value)}
          />

          <Alert severity="info">
            Il meteo nella stessa fascia usa le coordinate GPS del locale già impostate in
            Impostazioni → Timbrature (pensate per il raggio di timbratura, ma rappresentano
            comunque la posizione del locale): se non sono impostate, il meteo non viene mostrato.
          </Alert>

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
