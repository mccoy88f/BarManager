import { Box } from '@mui/material';
import { VenueSettings } from './VenueSettings';
import { Printers } from './Printers';
import { AppDomainCard } from './AppDomainCard';

export function SettingsHome() {
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <AppDomainCard />
      <VenueSettings />
      <Printers />
    </Box>
  );
}
