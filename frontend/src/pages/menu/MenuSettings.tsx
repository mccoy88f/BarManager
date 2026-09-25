import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';
import { OpeningHoursWeekEditor, type OpeningHoursDay } from '../../components/OpeningHoursWeekEditor';

interface VenueMenuHours {
  menuMealPeriodsHours: OpeningHoursDay[];
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Fasce pranzo/cena del menù (§5.10 di DEVELOPMENT.md): indipendenti
 * dall'orario reale di apertura (Impostazioni locale) — un locale può
 * restare aperto continuativamente e voler comunque distinguere le voci
 * di pranzo da quelle di cena nel menù pubblico.
 */
export function MenuSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [days, setDays] = useState<OpeningHoursDay[]>([]);

  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<VenueMenuHours>('/venues/me')).data,
  });

  useEffect(() => {
    if (venueQuery.data) setDays(venueQuery.data.menuMealPeriodsHours);
  }, [venueQuery.data]);

  const updateDay = (dayOfWeek: number, patch: Partial<OpeningHoursDay>) => {
    setDays((current) => current.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => (await api.patch('/venues/me/menu-hours', { days })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-me'] });
      showToast('Orari del menù aggiornati');
    },
    onError: (err) => showToast({ message: extractErrorMessage(err), severity: 'error' }),
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        sx={{ justifySelf: 'flex-start' }}
        onClick={() => navigate('/menu/admin')}
      >
        Menù
      </Button>

      <Box>
        <Typography variant="h5" fontWeight={700}>
          Impostazioni Menù
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Fasce pranzo/cena mostrate nel menù pubblico, indipendenti dall'orario reale di
          apertura del locale (Impostazioni locale): determinano solo quali voci "Solo
          pranzo"/"Solo cena" sono mostrate come disponibili in base all'ora corrente.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <OpeningHoursWeekEditor days={days} onChangeDay={updateDay} />
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={saveMutation.isPending || days.length === 0}
            onClick={() => saveMutation.mutate()}
          >
            Salva
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
