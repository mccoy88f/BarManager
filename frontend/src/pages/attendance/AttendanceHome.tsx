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
      <Grid item xs={12} sm={6}>
        <Card>
          <CardActionArea onClick={() => navigate('/attendance/employees')} sx={{ p: 2 }}>
            <CardContent>
              <Typography variant="h6">Dipendenti</Typography>
              <Typography variant="body2" color="text.secondary">
                Aggiungi, modifica ed elimina gli account del personale
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6}>
        <Card>
          <CardActionArea onClick={() => navigate('/attendance/qr-tokens')} sx={{ p: 2 }}>
            <CardContent>
              <Typography variant="h6">QR per timbratura</Typography>
              <Typography variant="body2" color="text.secondary">
                Genera e scarica i QR delle postazioni per inizio/fine turno
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
      <Grid item xs={12} sm={6}>
        <Card>
          <CardActionArea onClick={() => navigate('/attendance/records')} sx={{ p: 2 }}>
            <CardContent>
              <Typography variant="h6">Storico timbrature</Typography>
              <Typography variant="body2" color="text.secondary">
                Consulta ed esporta le presenze in XLS o PDF
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
    </Grid>
  );
}
