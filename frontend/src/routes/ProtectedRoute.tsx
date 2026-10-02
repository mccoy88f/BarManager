import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore, Role } from '../store/authStore';
import { canAccessModule, ModuleKey } from '../config/modules';

interface Props {
  allow?: Role[];
  /** In più (o al posto) del ruolo: richiede il modulo concesso dall'admin (vedi Employees.allowedModules). */
  moduleKey?: ModuleKey;
}

/**
 * Protegge le route dietro login e, opzionalmente, per ruolo e/o modulo.
 * Porta con sé la pagina richiesta (`state.from`): un link profondo
 * (es. quello nell'email di notifica della bacheca) deve riportare lì dopo
 * il login, non alla home, altrimenti il link "per andarla a vedere" non
 * serve a nulla per chi non ha già una sessione attiva nel browser.
 */
export function ProtectedRoute({ allow, moduleKey }: Props) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;
  if (moduleKey && !canAccessModule(user, moduleKey)) return <Navigate to="/" replace />;

  return <Outlet />;
}
