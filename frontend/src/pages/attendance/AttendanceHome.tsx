import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export function AttendanceHome() {
  const navigate = useNavigate();
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6}>
        <Card>
          <CardActionArea onClick={() => navigate('/attendance/leave-requests')} sx={{ p: 2 }}>
            <CardContent>
              <Typography variant="h6">Richieste assenza</Typography>
              <Typography variant="body2" color="text.secondary">
                Ferie, permessi, malattia
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
    </Grid>
  );
}
