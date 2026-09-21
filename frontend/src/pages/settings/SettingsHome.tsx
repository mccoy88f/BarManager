import { Box } from '@mui/material';
import { VenueSettings } from './VenueSettings';
import { Printers } from './Printers';

export function SettingsHome() {
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <VenueSettings />
      <Printers />
    </Box>
  );
}
