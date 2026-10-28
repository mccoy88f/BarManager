import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';

interface VenueDisplayPromoSettings {
  displayPromoEnabled: boolean;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Impostazioni del modulo Display Promo (§5.12): solo l'attivazione
 * generale. La playlist di default e la programmazione sono per singolo
 * display (un locale può averne più di uno), gestite nella pagina
 * principale "Display Promo", non qui.
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

  useEffect(() => {
    if (!venueQuery.data) return;
    setEnabled(venueQuery.data.displayPromoEnabled);
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (await api.patch('/venues/me/display-promo-settings', { displayPromoEnabled: enabled })).data,
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
