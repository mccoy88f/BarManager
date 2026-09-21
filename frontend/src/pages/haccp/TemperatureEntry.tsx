import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Typography,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface Fridge {
  id: string;
  label: string;
  minTemp: number;
  maxTemp: number;
}

/**
 * Form mobile-friendly: un frigo per riga, input numerico grande.
 * Se il valore è fuori soglia richiede obbligatoriamente l'azione correttiva
 * (requisito HACCP: l'anomalia va sempre accompagnata dalla correzione).
 */
export function TemperatureEntry() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [corrective, setCorrective] = useState<Record<string, string>>({});

  const fridgesQuery = useQuery({
    queryKey: ['fridges'],
    queryFn: async () => (await api.get<Fridge[]>('/haccp/fridges')).data,
  });

  const submitMutation = useMutation({
    mutationFn: async (fridgeId: string) =>
      (
        await api.post('/haccp/readings', {
          fridgeId,
          value: Number(values[fridgeId]),
          correctiveAction: corrective[fridgeId],
        })
      ).data,
    onSuccess: (_, fridgeId) => {
      setValues((v) => ({ ...v, [fridgeId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['readings'] });
    },
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h6">Rilevazione temperature</Typography>
      <Stack spacing={2}>
        {fridgesQuery.data?.map((fridge) => {
          const value = values[fridge.id] ?? '';
          const numValue = Number(value);
          const outOfRange =
            value !== '' && (numValue < fridge.minTemp || numValue > fridge.maxTemp);

          return (
            <Card key={fridge.id} variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600}>
                  {fridge.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Range accettabile: {fridge.minTemp}°C / {fridge.maxTemp}°C
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'center' }}>
                  <TextField
                    label="°C"
                    type="number"
                    value={value}
                    onChange={(e) => setValues((v) => ({ ...v, [fridge.id]: e.target.value }))}
                    sx={{ width: 120 }}
                  />
                  <Button
                    variant="contained"
                    disabled={
                      value === '' ||
                      (outOfRange && !corrective[fridge.id]) ||
                      submitMutation.isPending
                    }
                    onClick={() => submitMutation.mutate(fridge.id)}
                  >
                    Registra
                  </Button>
                </Box>
                {outOfRange && (
                  <>
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      Valore fuori soglia: indica l'azione correttiva
                    </Alert>
                    <TextField
                      label="Azione correttiva"
                      fullWidth
                      sx={{ mt: 1 }}
                      value={corrective[fridge.id] ?? ''}
                      onChange={(e) =>
                        setCorrective((c) => ({ ...c, [fridge.id]: e.target.value }))
                      }
                    />
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}
