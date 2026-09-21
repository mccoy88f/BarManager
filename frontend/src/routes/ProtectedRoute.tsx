import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, Role } from '../store/authStore';
import { canAccessModule, ModuleKey } from '../config/modules';

interface Props {
  allow?: Role[];
  /** In più (o al posto) del ruolo: richiede il modulo concesso dall'admin (vedi Employees.allowedModules). */
  moduleKey?: ModuleKey;
}

/** Protegge le route dietro login e, opzionalmente, per ruolo e/o modulo. */
export function ProtectedRoute({ allow, moduleKey }: Props) {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;
  if (moduleKey && !canAccessModule(user, moduleKey)) return <Navigate to="/" replace />;

  return <Outlet />;
}
