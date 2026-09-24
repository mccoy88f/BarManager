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
  /** Elenco di opzioni ristretto (es. solo gli orari apertura di un giorno specifico); se assente usa tutti i 96 quarti d'ora. */
  options?: string[];
  disabled?: boolean;
}

/**
 * Campo orario vincolato ai quarti d'ora (:00/:15/:30/:45). A differenza di
 * `<input type="time" step={900}>`, che limita solo lo stepper ma lascia
 * comunque digitare un minuto qualsiasi (es. 20:07) senza bloccarlo, qui la
 * selezione è vincolata a un elenco fisso di opzioni: si può digitare per
 * filtrare (es. "20" mostra 20:00/20:15/20:30/20:45), ma si può confermare
 * solo un valore della lista. Usato ovunque un orario di prenotazione va
 * scelto, sia nel widget pubblico sia in amministrazione. Il widget pubblico
 * passa un `options` già filtrato sugli orari di apertura del giorno scelto
 * (§5.7 di DEVELOPMENT.md): niente orario chiuso è selezionabile, senza per
 * questo dover mostrare in pagina l'elenco degli orari di apertura.
 */
export function QuarterHourTimeField({
  label,
  value,
  onChange,
  fullWidth,
  size,
  helperText,
  options,
  disabled,
}: QuarterHourTimeFieldProps) {
  return (
    <Autocomplete
      options={options ?? QUARTER_HOUR_OPTIONS}
      value={value || null}
      onChange={(_e, newValue) => onChange(newValue ?? '')}
      fullWidth={fullWidth}
      size={size}
      disabled={disabled}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
    />
  );
}
