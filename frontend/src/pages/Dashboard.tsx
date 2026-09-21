import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const modules = [
  {
    key: 'attendance',
    label: 'Presenze',
    description: 'Timbratura, richieste assenza',
    icon: AccessTimeIcon,
    path: '/attendance',
    roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    key: 'haccp',
    label: 'Controlli HACCP',
    description: 'Temperature frigoriferi, report',
    icon: ThermostatIcon,
    path: '/haccp',
    roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    key: 'inventory',
    label: 'Inventario e ordini',
    description: 'Prodotti, fornitori, nuovo ordine',
    icon: Inventory2Icon,
    path: '/inventory',
    roles: ['ADMIN', 'MANAGER'],
  },
];

export function Dashboard() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);

  const visible = modules.filter((m) => !role || m.roles.includes(role));

  return (
    <>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Moduli disponibili
      </Typography>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        {visible.map((m) => (
          <Grid item xs={12} sm={6} key={m.key}>
            <Card>
              <CardActionArea onClick={() => navigate(m.path)} sx={{ p: 1 }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <m.icon color="primary" sx={{ fontSize: 40 }} />
                  <div>
                    <Typography variant="h6">{m.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {m.description}
                    </Typography>
                  </div>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
