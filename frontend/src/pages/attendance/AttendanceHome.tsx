import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { navigation, canSeeNavItem } from '../../config/navigation';

const attendanceItem = navigation.find((item) => item.key === 'attendance')!;

/** Sotto-pagine di Presenze, filtrate per ruolo/permesso dell'utente loggato
 * (stessa configurazione condivisa della barra di navigazione: un Dipendente
 * non deve vedere una card che poi lo rimanda in home per mancati permessi). */
export function AttendanceHome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const items = (attendanceItem.children ?? []).filter((item) => canSeeNavItem(user, item));

  return (
    <Grid container spacing={2}>
      {items.map((item) => (
        <Grid item xs={12} sm={6} key={item.key}>
          <Card>
            <CardActionArea onClick={() => navigate(item.path)} sx={{ p: 2 }}>
              <CardContent>
                <Typography variant="h6">{item.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.description}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
