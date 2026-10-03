import { InputAdornment, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

interface TableSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Barra di ricerca testuale, condivisa da tutte le tabelle del sito. */
export function TableSearchField({ value, onChange, placeholder = 'Cerca...' }: TableSearchFieldProps) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      sx={{ minWidth: 240 }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
      }}
    />
  );
}
