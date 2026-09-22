import { useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { Fridges } from './Fridges';
import { TemperatureEntry } from './TemperatureEntry';
import { ReadingsHistory } from './ReadingsHistory';
import { CleaningTasksAdmin } from './CleaningTasksAdmin';
import { CleaningToday } from './CleaningToday';
import { CleaningLogHistory } from './CleaningLogHistory';
import { useAuthStore } from '../../store/authStore';

export function HaccpHome() {
  const [tab, setTab] = useState(0);
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Temperature" />
        <Tab label="Pulizie" />
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Fridges />
          <TemperatureEntry />
          <ReadingsHistory />
        </Box>
      )}

      {tab === 1 && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          {isAdmin ? (
            <>
              <CleaningTasksAdmin />
              <CleaningLogHistory />
            </>
          ) : (
            <CleaningToday />
          )}
        </Box>
      )}
    </Box>
  );
}
