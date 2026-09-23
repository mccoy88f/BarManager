import { Autocomplete, TextField } from '@mui/material';

/** Tutti gli orari della giornata ai quarti d'ora: 00:00, 00:15, ..., 23:45 (96 opzioni). */
const QUARTER_HOUR_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => {
  const hours = String(Math.floor(i / 4)).padStart(2, '0');
  const minutes = String((i % 4) * 15).padStart(2, '0');
  return `${hours}:${minutes}`;
});

interface QuarterHourTimeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  helperText?: string;
}

/**
 * Campo orario vincolato ai quarti d'ora (:00/:15/:30/:45). A differenza di
 * `<input type="time" step={900}>`, che limita solo lo stepper ma lascia
 * comunque digitare un minuto qualsiasi (es. 20:07) senza bloccarlo, qui la
 * selezione è vincolata a un elenco fisso di opzioni: si può digitare per
 * filtrare (es. "20" mostra 20:00/20:15/20:30/20:45), ma si può confermare
 * solo un valore della lista. Usato ovunque un orario di prenotazione va
 * scelto, sia nel widget pubblico sia in amministrazione.
 */
export function QuarterHourTimeField({
  label,
  value,
  onChange,
  fullWidth,
  size,
  helperText,
}: QuarterHourTimeFieldProps) {
  return (
    <Autocomplete
      options={QUARTER_HOUR_OPTIONS}
      value={value || null}
      onChange={(_e, newValue) => onChange(newValue ?? '')}
      fullWidth={fullWidth}
      size={size}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
    />
  );
}
