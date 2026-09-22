import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { navigation, canSeeNavItem } from '../../config/navigation';

const haccpItem = navigation.find((item) => item.key === 'haccp')!;

/** Sotto-sezioni di Controlli HACCP: Temperature e Pulizie, come pagine
 * separate invece di tab interne (stesso schema di Presenze/Inventario). */
export function HaccpHome() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const items = (haccpItem.children ?? []).filter((item) => canSeeNavItem(user, item));

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
