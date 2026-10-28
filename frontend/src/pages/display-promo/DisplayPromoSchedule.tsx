import { Fragment, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Card, CardContent, MenuItem, TextField, Typography } from '@mui/material';
import { api } from '../../api/client';

type Shift = 'LUNCH' | 'DINNER';

interface DisplayPromoPlaylist {
  id: string;
  name: string;
}
interface ScheduleSlot {
  dayOfWeek: number;
  shift: Shift;
  playlistId: string;
}

const DAY_LABELS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const SHIFT_LABELS: Record<Shift, string> = { LUNCH: 'Pranzo', DINNER: 'Cena' };
const NO_PLAYLIST = '__none__';

/**
 * Griglia 7 giorni × 2 turni (§5.12 di DEVELOPMENT.md): per ogni cella si
 * sceglie quale playlist mostrare sui display durante quel turno. Una
 * cella lasciata su "Playlist di default" non ha una riga di
 * programmazione — fuori da qualunque turno si usa comunque sempre la
 * playlist di default (impostata in Impostazioni), stesso comportamento
 * di una cella vuota.
 */
export function DisplayPromoSchedule() {
  const queryClient = useQueryClient();

  const playlistsQuery = useQuery({
    queryKey: ['display-promo-playlists'],
    queryFn: async () => (await api.get<DisplayPromoPlaylist[]>('/display-promo/playlists')).data,
  });

  const scheduleQuery = useQuery({
    queryKey: ['display-promo-schedule'],
    queryFn: async () => (await api.get<ScheduleSlot[]>('/display-promo/schedule')).data,
  });

  const slotByKey = useMemo(() => {
    const map = new Map<string, string>();
    scheduleQuery.data?.forEach((slot) => map.set(`${slot.dayOfWeek}-${slot.shift}`, slot.playlistId));
    return map;
  }, [scheduleQuery.data]);

  const setSlotMutation = useMutation({
    mutationFn: async ({ dayOfWeek, shift, playlistId }: { dayOfWeek: number; shift: Shift; playlistId: string | null }) =>
      (await api.patch(`/display-promo/schedule/${dayOfWeek}/${shift}`, { playlistId })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['display-promo-schedule'] }),
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Programmazione settimanale
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Scegli quale playlist mostrare sui display per ogni giorno e turno (pranzo/cena, stessi
          orari configurati per il menù). Fuori da questi turni, o per una cella senza playlist
          scelta qui, si usa sempre la playlist di default impostata in "Impostazioni".
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent sx={{ overflowX: 'auto' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `140px repeat(2, minmax(180px, 1fr))`,
              gap: 1,
              minWidth: 520,
            }}
          >
            <Box />
            {(['LUNCH', 'DINNER'] as Shift[]).map((shift) => (
              <Typography key={shift} variant="subtitle2" fontWeight={700} textAlign="center">
                {SHIFT_LABELS[shift]}
              </Typography>
            ))}
            {DAY_LABELS.map((dayLabel, dayOfWeek) => (
              <Fragment key={dayOfWeek}>
                <Typography variant="body2" fontWeight={600} sx={{ alignSelf: 'center' }}>
                  {dayLabel}
                </Typography>
                {(['LUNCH', 'DINNER'] as Shift[]).map((shift) => {
                  const value = slotByKey.get(`${dayOfWeek}-${shift}`) ?? NO_PLAYLIST;
                  return (
                    <TextField
                      key={`${dayOfWeek}-${shift}`}
                      select
                      size="small"
                      value={value}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSlotMutation.mutate({
                          dayOfWeek,
                          shift,
                          playlistId: next === NO_PLAYLIST ? null : next,
                        });
                      }}
                    >
                      <MenuItem value={NO_PLAYLIST}>
                        <em>Playlist di default</em>
                      </MenuItem>
                      {playlistsQuery.data?.map((playlist) => (
                        <MenuItem key={playlist.id} value={playlist.id}>
                          {playlist.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  );
                })}
              </Fragment>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
