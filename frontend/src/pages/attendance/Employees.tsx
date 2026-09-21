import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MODULE_LABELS, ModuleKey } from '../../config/modules';

const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS) as ModuleKey[];

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  role?: string;
  department?: string;
  phone?: string;
  isManager: boolean;
  active: boolean;
  allowedModules: string[];
  user?: { id: string; email: string; active: boolean; role: string } | null;
}

const emptyCreateForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: '',
  department: '',
  isManager: false,
  allowedModules: [] as string[],
};

const emptyEditForm = {
  firstName: '',
  lastName: '',
  role: '',
  department: '',
  phone: '',
  isManager: false,
  email: '',
  password: '',
  allowedModules: [] as string[],
};

function toggleModule(list: string[], key: ModuleKey): string[] {
  return list.includes(key) ? list.filter((m) => m !== key) : [...list, key];
}

function ModulesCheckboxes({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Box sx={{ gridColumn: '1 / -1' }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Moduli a cui può accedere, indipendentemente dal ruolo. Nessuna selezione = permessi di
        default (Dipendente: solo HACCP; Responsabile: tutti). Selezionandone anche uno solo,
        l'elenco scelto qui sostituisce il default.
      </Typography>
      <FormGroup row>
        {ALL_MODULE_KEYS.map((key) => (
          <FormControlLabel
            key={key}
            control={
              <Checkbox
                checked={value.includes(key)}
                onChange={() => onChange(toggleModule(value, key))}
              />
            }
            label={MODULE_LABELS[key]}
          />
        ))}
      </FormGroup>
    </Box>
  );
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Anagrafica dipendenti: crea gli account (email+password) con cui accedono. */
export function Employees() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<EmployeeRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const employeesQuery = useQuery({
    queryKey: ['employees-admin'],
    queryFn: async () => (await api.get<EmployeeRow[]>('/employees')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['employees-admin'] });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/employees', {
          ...form,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
        })
      ).data,
    onSuccess: () => {
      invalidate();
      setForm(emptyCreateForm);
      setCreateError(null);
    },
    onError: (err) => setCreateError(extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const payload: Record<string, unknown> = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        role: editForm.role,
        department: editForm.department,
        phone: editForm.phone,
        isManager: editForm.isManager,
        allowedModules: editForm.allowedModules,
      };
      if (editForm.email.trim()) payload.email = editForm.email.trim();
      if (editForm.password) payload.password = editForm.password;
      return (await api.patch(`/employees/${editing.id}`, payload)).data;
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setEditError(null);
    },
    onError: (err) => setEditError(extractErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/employees/${id}/active`, { active })).data,
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/employees/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setToDelete(null);
      setDeleteError(null);
    },
    onError: (err) => setDeleteError(extractErrorMessage(err)),
  });

  const openEdit = (employee: EmployeeRow) => {
    setEditing(employee);
    setEditError(null);
    setEditForm({
      firstName: employee.firstName,
      lastName: employee.lastName,
      role: employee.role ?? '',
      department: employee.department ?? '',
      phone: employee.phone ?? '',
      isManager: employee.isManager,
      email: employee.user?.email ?? '',
      password: '',
      allowedModules: employee.allowedModules,
    });
  };

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Nuovo dipendente
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
            <TextField
              label="Nome"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <TextField
              label="Cognome"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
            <TextField
              label="Email di accesso"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextField
              label="Password iniziale"
              type="password"
              helperText="Almeno 8 caratteri"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <TextField
              label="Mansione"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
            <TextField
              label="Reparto"
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
            />
            <ModulesCheckboxes
              value={form.allowedModules}
              onChange={(allowedModules) => setForm((f) => ({ ...f, allowedModules }))}
            />
          </Box>
          {createError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setCreateError(null)}>
              {createError}
            </Alert>
          )}
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            disabled={
              !form.firstName ||
              !form.lastName ||
              !form.email ||
              form.password.length < 8 ||
              createMutation.isPending
            }
            onClick={() => createMutation.mutate()}
          >
            Aggiungi
          </Button>
        </CardContent>
      </Card>

      <Typography variant="h6">Dipendenti</Typography>
      <Stack spacing={2}>
        {employeesQuery.data?.map((employee) => (
          <Card key={employee.id} variant="outlined">
            <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>
                  {employee.firstName} {employee.lastName}
                  {employee.isManager && (
                    <Chip size="small" label="Responsabile" sx={{ ml: 1 }} />
                  )}
                  {!employee.active && (
                    <Chip size="small" color="default" label="Disattivato" sx={{ ml: 1 }} />
                  )}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {employee.user?.email}
                  {employee.role && ` — ${employee.role}`}
                  {employee.department && ` — ${employee.department}`}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Switch
                  checked={employee.active}
                  title="Attivo/disattivo"
                  onChange={(e) =>
                    toggleActiveMutation.mutate({ id: employee.id, active: e.target.checked })
                  }
                />
                <IconButton title="Modifica" onClick={() => openEdit(employee)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton
                  title="Elimina"
                  onClick={() => {
                    setDeleteError(null);
                    setToDelete(employee);
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Modifica dipendente</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr', pt: 1 }}>
          <TextField
            label="Nome"
            value={editForm.firstName}
            onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
          />
          <TextField
            label="Cognome"
            value={editForm.lastName}
            onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
          />
          <TextField
            label="Mansione"
            value={editForm.role}
            onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
          />
          <TextField
            label="Reparto"
            value={editForm.department}
            onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
          />
          <TextField
            label="Telefono"
            value={editForm.phone}
            onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <TextField
            label="Email di accesso"
            type="email"
            value={editForm.email}
            onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
          />
          <TextField
            label="Nuova password (opzionale)"
            type="password"
            helperText="Lascia vuoto per non cambiarla"
            value={editForm.password}
            onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
            sx={{ gridColumn: '1 / -1' }}
          />
          <ModulesCheckboxes
            value={editForm.allowedModules}
            onChange={(allowedModules) => setEditForm((f) => ({ ...f, allowedModules }))}
          />
          {editError && (
            <Alert severity="error" sx={{ gridColumn: '1 / -1' }} onClose={() => setEditError(null)}>
              {editError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={
              !editForm.firstName ||
              !editForm.lastName ||
              (!!editForm.password && editForm.password.length < 8) ||
              updateMutation.isPending
            }
            onClick={() => updateMutation.mutate()}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Eliminare il dipendente?"
        message={
          toDelete
            ? `"${toDelete.firstName} ${toDelete.lastName}" e il suo account verranno eliminati definitivamente. Se ha timbrature o richieste collegate, disattivalo invece.${
                deleteError ? `\n\n${deleteError}` : ''
              }`
            : ''
        }
        loading={deleteMutation.isPending}
        onCancel={() => {
          setToDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </Box>
  );
}
