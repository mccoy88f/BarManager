import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';

export interface OpeningHoursDay {
  /** 0 = domenica .. 6 = sabato, come Date#getDay(). */
  dayOfWeek: number;
  closed: boolean;
  slot1Start: string | null;
  slot1End: string | null;
  slot2Start: string | null;
  slot2End: string | null;
}

/** Lunedì(1)...domenica(0), nell'ordine in cui mostrarli in UI: Date#getDay() usa invece 0=domenica. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_LABELS: Record<number, string> = {
  0: 'Domenica',
  1: 'Lunedì',
  2: 'Martedì',
  3: 'Mercoledì',
  4: 'Giovedì',
  5: 'Venerdì',
  6: 'Sabato',
};

/**
 * Editor dei "7 giorni x fino a 2 fasce orarie" (chiuso/aperto, dalle-alle,
 * seconda fascia opzionale) — stesso blocco duplicato finora in
 * VenueSettings.tsx (orario reale), OnlineOrdersSettings.tsx (orari ordini
 * online) e MenuSettings.tsx (orari pranzo/cena del menù, §5.10). Solo la
 * griglia: il chiamante resta responsabile di titolo/descrizione, del
 * pulsante "Salva" e della mutation di salvataggio, che differiscono per
 * ciascun uso.
 */
export function OpeningHoursWeekEditor({
  days,
  onChangeDay,
}: {
  days: OpeningHoursDay[];
  onChangeDay: (dayOfWeek: number, patch: Partial<OpeningHoursDay>) => void;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {DAY_ORDER.map((dayOfWeek) => {
        const day = days.find((d) => d.dayOfWeek === dayOfWeek);
        if (!day) return null;
        const hasSlot2 = day.slot2Start != null && day.slot2End != null;
        return (
          <Box
            key={dayOfWeek}
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ width: 100, flexShrink: 0 }}>
              {DAY_LABELS[dayOfWeek]}
            </Typography>
            <FormControlLabel
              sx={{ mr: 0 }}
              control={
                <Switch
                  size="small"
                  checked={!day.closed}
                  onChange={(e) => onChangeDay(dayOfWeek, { closed: !e.target.checked })}
                />
              }
              label={day.closed ? 'Chiuso' : 'Aperto'}
            />
            {!day.closed && (
              <>
                <TextField
                  label="Dalle"
                  type="time"
                  size="small"
                  inputProps={{ step: 900 }}
                  InputLabelProps={{ shrink: true }}
                  value={day.slot1Start ?? ''}
                  onChange={(e) => onChangeDay(dayOfWeek, { slot1Start: e.target.value })}
                />
                <TextField
                  label="Alle"
                  type="time"
                  size="small"
                  inputProps={{ step: 900 }}
                  InputLabelProps={{ shrink: true }}
                  value={day.slot1End ?? ''}
                  onChange={(e) => onChangeDay(dayOfWeek, { slot1End: e.target.value })}
                />
                {hasSlot2 ? (
                  <>
                    <TextField
                      label="Dalle (2ª fascia)"
                      type="time"
                      size="small"
                      inputProps={{ step: 900 }}
                      InputLabelProps={{ shrink: true }}
                      value={day.slot2Start ?? ''}
                      onChange={(e) => onChangeDay(dayOfWeek, { slot2Start: e.target.value })}
                    />
                    <TextField
                      label="Alle (2ª fascia)"
                      type="time"
                      size="small"
                      inputProps={{ step: 900 }}
                      InputLabelProps={{ shrink: true }}
                      value={day.slot2End ?? ''}
                      onChange={(e) => onChangeDay(dayOfWeek, { slot2End: e.target.value })}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => onChangeDay(dayOfWeek, { slot2Start: null, slot2End: null })}
                    >
                      Rimuovi 2ª fascia
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    onClick={() => onChangeDay(dayOfWeek, { slot2Start: '19:00', slot2End: '23:00' })}
                  >
                    + Aggiungi seconda fascia
                  </Button>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
