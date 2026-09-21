import { Box } from '@mui/material';
import { Fridges } from './Fridges';
import { TemperatureEntry } from './TemperatureEntry';
import { ReadingsHistory } from './ReadingsHistory';

export function HaccpHome() {
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Fridges />
      <TemperatureEntry />
      <ReadingsHistory />
    </Box>
  );
}
