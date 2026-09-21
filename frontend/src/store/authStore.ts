import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

interface AuthUser {
  userId: string;
  email: string;
  role: Role;
  /** null solo per SUPER_ADMIN, trasversale ai locali. */
  venueId: string | null;
  /** Solo per Manager/Dipendente: moduli extra concessi dall'admin (vedi Employees). */
  allowedModules?: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  venueName: string | null;
  setSession: (accessToken: string, refreshToken: string, user: AuthUser, venueName?: string | null) => void;
  setAccessToken: (accessToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      venueName: null,
      setSession: (accessToken, refreshToken, user, venueName = null) =>
        set({ accessToken, refreshToken, user, venueName }),
      setAccessToken: (accessToken) => set({ accessToken }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null, venueName: null }),
    }),
    { name: 'barmanager-auth' },
  ),
);
