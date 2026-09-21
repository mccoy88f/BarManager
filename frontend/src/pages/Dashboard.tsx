import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import EventNoteIcon from '@mui/icons-material/EventNote';
import SettingsIcon from '@mui/icons-material/Settings';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore, Role } from '../store/authStore';
import { AdminSummary } from '../components/AdminSummary';

const modules = [
  {
    key: 'attendance',
    label: 'Presenze',
    description: 'Timbratura, richieste assenza',
    icon: AccessTimeIcon,
    path: '/attendance',
    roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] as Role[],
  },
  {
    key: 'haccp',
    label: 'Controlli HACCP',
    description: 'Temperature frigoriferi, report',
    icon: ThermostatIcon,
    path: '/haccp',
    roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] as Role[],
  },
  {
    key: 'inventory',
    label: 'Inventario e ordini',
    description: 'Prodotti, fornitori, nuovo ordine',
    icon: Inventory2Icon,
    path: '/inventory',
    roles: ['ADMIN', 'MANAGER'] as Role[],
  },
  {
    key: 'menu',
    label: 'Menù online',
    description: 'Categorie, piatti, disponibilità',
    icon: RestaurantMenuIcon,
    path: '/menu/admin',
    roles: ['ADMIN', 'MANAGER'] as Role[],
  },
  {
    key: 'tasks',
    label: 'Attività e scadenze',
    description: 'Pagamenti, visite mediche, attestati',
    icon: EventNoteIcon,
    path: '/tasks',
    roles: ['ADMIN', 'MANAGER'] as Role[],
  },
  {
    key: 'settings',
    label: 'Impostazioni locale',
    description: 'Fasce orarie pranzo/cena, stampanti',
    icon: SettingsIcon,
    path: '/settings',
    roles: ['ADMIN'] as Role[],
  },
];

export function Dashboard() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);

  // Il Super Admin non opera sui moduli di un locale: la sua dashboard è la
  // gestione locali.
  if (role === 'SUPER_ADMIN') {
    return <Navigate to="/super-admin/venues" replace />;
  }

  const visible = modules.filter((m) => !role || m.roles.includes(role));
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER';

  return (
    <>
      {isAdminOrManager && <AdminSummary />}

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
