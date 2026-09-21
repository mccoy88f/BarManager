import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface VenueHours {
  id: string;
  name: string;
  slug: string;
  lunchStart: string;
  lunchEnd: string;
  dinnerStart: string;
  dinnerEnd: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Fasce orarie pranzo/cena del locale: determinano quali voci di menù sono
 * mostrate come disponibili nel menù pubblico in base all'ora corrente. */
export function VenueSettings() {
  const [hours, setHours] = useState({
    lunchStart: '',
    lunchEnd: '',
    dinnerStart: '',
    dinnerEnd: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueHours>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) {
      setHours({
        lunchStart: venueQuery.data.lunchStart,
        lunchEnd: venueQuery.data.lunchEnd,
        dinnerStart: venueQuery.data.dinnerStart,
        dinnerEnd: venueQuery.data.dinnerEnd,
      });
    }
  }, [venueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/hours', hours)).data,
    onSuccess: () => {
      setError(null);
      setSuccess(true);
    },
    onError: (err) => {
      setSuccess(false);
      setError(extractErrorMessage(err));
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Fasce orarie del menù
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Determinano quali voci "Solo pranzo"/"Solo cena" sono mostrate come disponibili nel
            menù pubblico in base all'ora corrente.
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' }, maxWidth: 400 }}>
            <TextField
              label="Inizio pranzo"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.lunchStart}
              onChange={(e) => setHours((h) => ({ ...h, lunchStart: e.target.value }))}
            />
            <TextField
              label="Fine pranzo"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.lunchEnd}
              onChange={(e) => setHours((h) => ({ ...h, lunchEnd: e.target.value }))}
            />
            <TextField
              label="Inizio cena"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.dinnerStart}
              onChange={(e) => setHours((h) => ({ ...h, dinnerStart: e.target.value }))}
            />
            <TextField
              label="Fine cena"
              type="time"
              InputLabelProps={{ shrink: true }}
              value={hours.dinnerEnd}
              onChange={(e) => setHours((h) => ({ ...h, dinnerEnd: e.target.value }))}
            />
          </Box>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSuccess(false)}>
              Fasce orarie aggiornate.
            </Alert>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
