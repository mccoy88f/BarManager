import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AttendanceHome } from './pages/attendance/AttendanceHome';
import { ClockPage } from './pages/attendance/ClockPage';
import { LeaveRequests } from './pages/attendance/LeaveRequests';
import { Employees } from './pages/attendance/Employees';
import { QrTokens } from './pages/attendance/QrTokens';
import { AttendanceRecords } from './pages/attendance/AttendanceRecords';
import { HaccpHome } from './pages/haccp/HaccpHome';
import { InventoryHome } from './pages/inventory/InventoryHome';
import { Suppliers } from './pages/inventory/Suppliers';
import { Catalog } from './pages/inventory/Catalog';
import { MenuAdmin } from './pages/menu/MenuAdmin';
import { PublicMenu } from './pages/menu/PublicMenu';
import { TasksAdmin } from './pages/tasks/TasksAdmin';
import { Venues } from './pages/super-admin/Venues';
import { SettingsHome } from './pages/settings/SettingsHome';

export default function App() {
  return (
    <Routes>
      {/* Menù pubblico: nessun login, nessuna shell applicativa */}
      <Route path="/menu" element={<PublicMenu />} />

      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clock/:token" element={<ClockPage />} />
          <Route path="/attendance" element={<AttendanceHome />} />
          <Route path="/attendance/leave-requests" element={<LeaveRequests />} />

          {/* Gestione dipendenti/postazioni: sempre riservata ad Admin/Manager,
              non concedibile via permessi per modulo (non è un "modulo" ma
              amministrazione del personale). */}
          <Route element={<ProtectedRoute allow={['ADMIN', 'MANAGER']} />}>
            <Route path="/attendance/employees" element={<Employees />} />
            <Route path="/attendance/records" element={<AttendanceRecords />} />
          </Route>
          <Route element={<ProtectedRoute allow={['ADMIN']} />}>
            <Route path="/attendance/qr-tokens" element={<QrTokens />} />
            <Route path="/settings" element={<SettingsHome />} />
          </Route>

          {/* Moduli concedibili per singolo dipendente (Employees.allowedModules):
              l'Admin ha sempre accesso, Manager/Dipendente in base al permesso. */}
          <Route element={<ProtectedRoute moduleKey="haccp" />}>
            <Route path="/haccp" element={<HaccpHome />} />
          </Route>
          <Route element={<ProtectedRoute moduleKey="inventory" />}>
            <Route path="/inventory" element={<InventoryHome />} />
            <Route path="/inventory/suppliers" element={<Suppliers />} />
            <Route path="/inventory/catalog" element={<Catalog />} />
          </Route>
          <Route element={<ProtectedRoute moduleKey="menu" />}>
            <Route path="/menu/admin" element={<MenuAdmin />} />
          </Route>
          <Route element={<ProtectedRoute moduleKey="tasks" />}>
            <Route path="/tasks" element={<TasksAdmin />} />
          </Route>

          <Route element={<ProtectedRoute allow={['SUPER_ADMIN']} />}>
            <Route path="/super-admin/venues" element={<Venues />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
