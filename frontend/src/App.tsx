import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AttendanceHome } from './pages/attendance/AttendanceHome';
import { ClockPage } from './pages/attendance/ClockPage';
import { LeaveRequests } from './pages/attendance/LeaveRequests';
import { HaccpHome } from './pages/haccp/HaccpHome';
import { InventoryHome } from './pages/inventory/InventoryHome';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clock/:token" element={<ClockPage />} />
          <Route path="/attendance" element={<AttendanceHome />} />
          <Route path="/attendance/leave-requests" element={<LeaveRequests />} />
          <Route path="/haccp" element={<HaccpHome />} />
          <Route element={<ProtectedRoute allow={['ADMIN', 'MANAGER']} />}>
            <Route path="/inventory" element={<InventoryHome />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
