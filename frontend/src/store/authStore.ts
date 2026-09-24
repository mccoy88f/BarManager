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
  /** Solo per Manager/Dipendente: dipendente "Responsabile" (vedi Employees). */
  isManager?: boolean;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  venueName: string | null;
  /** Colore accento del locale (v. Impostazioni > Tema): null = non ancora personalizzato. */
  themeAccentColor: string | null;
  setSession: (
    accessToken: string,
    refreshToken: string,
    user: AuthUser,
    venueName?: string | null,
    themeAccentColor?: string | null,
  ) => void;
  setAccessToken: (accessToken: string) => void;
  updateUserEmail: (email: string) => void;
  /** Aggiorna il colore accento cache col valore live letto da /venues/me (v. AppShell), per chi non ha fatto login di recente. */
  setThemeAccentColor: (themeAccentColor: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      venueName: null,
      themeAccentColor: null,
      setSession: (accessToken, refreshToken, user, venueName = null, themeAccentColor = null) =>
        set({ accessToken, refreshToken, user, venueName, themeAccentColor }),
      setAccessToken: (accessToken) => set({ accessToken }),
      updateUserEmail: (email) =>
        set((state) => (state.user ? { user: { ...state.user, email } } : {})),
      setThemeAccentColor: (themeAccentColor) => set({ themeAccentColor }),
      logout: () =>
        set({ accessToken: null, refreshToken: null, user: null, venueName: null, themeAccentColor: null }),
    }),
    { name: 'barmanager-auth' },
  ),
);
