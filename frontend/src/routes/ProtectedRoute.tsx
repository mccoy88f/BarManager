import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, Role } from '../store/authStore';

interface Props {
  allow?: Role[];
}

/** Protegge le route dietro login e, opzionalmente, per ruolo. */
export function ProtectedRoute({ allow }: Props) {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
