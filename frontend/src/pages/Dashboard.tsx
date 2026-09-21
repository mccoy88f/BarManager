import { Card, CardActionArea, CardContent, Typography, Grid } from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { AdminSummary } from '../components/AdminSummary';
import { EmployeeSummary } from '../components/EmployeeSummary';
import { navigation, canSeeNavItem } from '../config/navigation';

export function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  // Il Super Admin non opera sui moduli di un locale: la sua dashboard è la
  // gestione locali.
  if (role === 'SUPER_ADMIN') {
    return <Navigate to="/super-admin/venues" replace />;
  }

  // Stessa configurazione usata dalla barra di navigazione e dalle
  // breadcrumb (frontend/src/config/navigation.ts), per non duplicare
  // l'elenco moduli/permessi in più punti.
  const visible = navigation.filter((item) => canSeeNavItem(user, item));
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER';
  const isEmployeeOrManager = role === 'EMPLOYEE' || role === 'MANAGER';

  return (
    <>
      {isAdminOrManager && <AdminSummary />}
      {isEmployeeOrManager && <EmployeeSummary />}

      <Typography variant="h5" fontWeight={700} gutterBottom>
        Moduli disponibili
      </Typography>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        {visible.map((item) => (
          <Grid item xs={12} sm={6} key={item.key}>
            <Card>
              <CardActionArea onClick={() => navigate(item.path)} sx={{ p: 1 }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <item.icon color="primary" sx={{ fontSize: 40 }} />
                  <div>
                    <Typography variant="h6">{item.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {item.description}
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
