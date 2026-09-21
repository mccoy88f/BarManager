import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Relativo di proposito: frontend e API vivono sempre sullo stesso
// sotto-dominio (proxy Nginx in produzione, proxy Vite in sviluppo), così
// non serve alcuna configurazione per-locale lato client né CORS.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Se l'access token è scaduto, prova un refresh automatico una sola volta.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          useAuthStore.getState().setAccessToken(data.accessToken);
          original.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(original);
        } catch {
          useAuthStore.getState().logout();
        }
      }
    }
    return Promise.reject(error);
  },
);
