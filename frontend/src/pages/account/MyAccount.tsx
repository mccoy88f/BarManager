import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ToastProvider';

interface MeProfile {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/**
 * Autogestione dei propri dati/password, per qualunque ruolo. firstName/
 * lastName/phone esistono solo per chi ha una scheda Employee collegata
 * (Manager/Dipendente): per Admin/Super Admin il backend le ignora, quindi
 * qui non vengono nemmeno mostrate.
 */
export function MyAccount() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const updateUserEmail = useAuthStore((s) => s.updateUserEmail);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<MeProfile>('/me')).data,
  });

  useEffect(() => {
    if (meQuery.data) {
      setEmail(meQuery.data.email);
      setFirstName(meQuery.data.firstName ?? '');
      setLastName(meQuery.data.lastName ?? '');
      setPhone(meQuery.data.phone ?? '');
    }
  }, [meQuery.data]);

  const hasEmployeeFields =
    meQuery.data?.role === 'MANAGER' || meQuery.data?.role === 'EMPLOYEE';

  const saveProfileMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch<MeProfile>('/me', {
          email,
          ...(hasEmployeeFields ? { firstName, lastName, phone } : {}),
        })
      ).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      updateUserEmail(data.email);
      setProfileError(null);
      showToast('Dati aggiornati');
    },
    onError: (err) => setProfileError(extractErrorMessage(err)),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () =>
      (await api.patch('/me/password', { currentPassword, newPassword })).data,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      showToast('Password aggiornata');
    },
    onError: (err) => setPasswordError(extractErrorMessage(err)),
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      setPasswordError('Le due password non coincidono.');
      return;
    }
    changePasswordMutation.mutate();
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h5">Il mio profilo</Typography>

      <Card>
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="h6">I miei dati</Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
            {hasEmployeeFields && (
              <>
                <TextField
                  label="Nome"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <TextField
                  label="Cognome"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
                <TextField
                  label="Telefono"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </>
            )}
          </Box>
          {profileError && (
            <Alert severity="error" onClose={() => setProfileError(null)}>
              {profileError}
            </Alert>
          )}
          <Box>
            <Button
              variant="contained"
              disabled={!email || saveProfileMutation.isPending}
              onClick={() => saveProfileMutation.mutate()}
            >
              Salva
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="h6">Cambia password</Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField
              label="Password attuale"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
            <TextField
              label="Nuova password"
              type="password"
              helperText="Almeno 8 caratteri"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <TextField
              label="Conferma nuova password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Box>
          {passwordError && (
            <Alert severity="error" onClose={() => setPasswordError(null)}>
              {passwordError}
            </Alert>
          )}
          <Box>
            <Button
              variant="contained"
              disabled={
                !currentPassword ||
                newPassword.length < 8 ||
                !confirmPassword ||
                changePasswordMutation.isPending
              }
              onClick={handleChangePassword}
            >
              Aggiorna password
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
