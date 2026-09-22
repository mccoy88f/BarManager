import { Box } from '@mui/material';
import { CleaningTasksAdmin } from './CleaningTasksAdmin';
import { CleaningToday } from './CleaningToday';
import { CleaningLogHistory } from './CleaningLogHistory';
import { useAuthStore } from '../../store/authStore';

export function HaccpCleaning() {
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {/* Anche l'admin deve poter segnare una pulizia come fatta, non solo gestire l'elenco. */}
      <CleaningToday />
      {isAdmin && (
        <>
          <CleaningTasksAdmin />
          <CleaningLogHistory />
        </>
      )}
    </Box>
  );
}
