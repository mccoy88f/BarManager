import { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography, Alert } from '@mui/material';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setSession(data.accessToken, data.refreshToken, data.user, data.venueName, data.themeAccentColor);
      // Torna alla pagina da cui si arrivava (es. un link diretto da
      // un'email, come la notifica di un nuovo messaggio in bacheca),
      // non sempre alla home — v. ProtectedRoute.
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from ? `${from.pathname}${from.search}` : '/', { replace: true });
    } catch {
      setError('Credenziali non valide');
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
      <Card sx={{ maxWidth: 380, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            Bar Management
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Accedi con le credenziali fornite dall'amministratore
          </Typography>
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2, display: 'grid', gap: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" fullWidth>
              Accedi
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
