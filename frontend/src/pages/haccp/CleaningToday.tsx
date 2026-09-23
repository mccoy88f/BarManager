import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useToast } from '../../components/ToastProvider';

type FrequencyUnit = 'DAY' | 'WEEK' | 'MONTH';

interface DueCleaningTask {
  id: string;
  description: string;
  location: string;
  frequencyUnit: FrequencyUnit;
  timesPerUnit: number;
  completedInPeriod: number;
  remaining: number;
}

const unitLabels: Record<FrequencyUnit, string> = {
  DAY: 'oggi',
  WEEK: 'questa settimana',
  MONTH: 'questo mese',
};

/**
 * Checklist pulizie del periodo corrente: ogni dipendente vede cosa c'è da
 * fare (giorno/settimana/mese in corso) e la segna come fatta.
 */
export function CleaningToday() {
  const queryClient = useQueryClient();
  const showToast = useToast();

  const dueQuery = useQuery({
    queryKey: ['cleaning-due'],
    queryFn: async () => (await api.get<DueCleaningTask[]>('/haccp/cleaning-tasks/due')).data,
  });

  const completeMutation = useMutation({
    mutationFn: async (taskId: string) =>
      (await api.post(`/haccp/cleaning-tasks/${taskId}/complete`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaning-due'] });
      showToast('Pulizia registrata');
    },
  });

  const toDo = dueQuery.data?.filter((t) => t.remaining > 0) ?? [];
  const done = dueQuery.data?.filter((t) => t.remaining === 0) ?? [];

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Pulizie da fare
        </Typography>
        <Stack spacing={1}>
          {toDo.map((task) => (
            <Box
              key={task.id}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {task.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {task.location}
                  {task.timesPerUnit > 1 &&
                    ` — ${task.completedInPeriod}/${task.timesPerUnit} ${unitLabels[task.frequencyUnit]}`}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={<CheckIcon />}
                disabled={completeMutation.isPending}
                onClick={() => completeMutation.mutate(task.id)}
              >
                Fatto
              </Button>
            </Box>
          ))}
          {toDo.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nessuna pulizia da fare al momento.
            </Typography>
          )}
        </Stack>

        {done.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }} color="text.secondary">
              Già fatte
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {done.map((task) => (
                <Chip
                  key={task.id}
                  size="small"
                  color="success"
                  variant="outlined"
                  icon={<CheckIcon />}
                  label={`${task.description} — ${task.location}`}
                />
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
