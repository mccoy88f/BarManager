import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DirectionsIcon from '@mui/icons-material/Directions';
import { api } from '../../api/client';
import { NEUTRAL_CHIP_COLOR, SUCCESS_CHIP_COLOR } from '../../config/statusChip';

type HistoryStatus = 'COMPLETED' | 'REJECTED' | 'CANCELLED';

interface OrderRow {
  id: string;
  status: HistoryStatus;
  fulfillment: 'PICKUP' | 'DELIVERY';
  requestedAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  total: number;
  paymentMethod: 'CASH' | 'CARD_ONLINE' | 'CARD_IN_STORE' | null;
  loyverseReceiptId: string | null;
  loyverseSyncError: string | null;
  deliveryAddress?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const statusLabels: Record<HistoryStatus, string> = {
  COMPLETED: 'Completato',
  REJECTED: 'Rifiutato',
  CANCELLED: 'Annullato',
};

const statusColors: Record<HistoryStatus, 'success' | 'default'> = {
  COMPLETED: SUCCESS_CHIP_COLOR,
  REJECTED: NEUTRAL_CHIP_COLOR,
  CANCELLED: NEUTRAL_CHIP_COLOR,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

function navigateUrl(lat?: number | null, lng?: number | null, address?: string | null): string {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  return '';
}

/** Storico ordini online (§5.10): stesso schema di paginazione/ricerca client-side già in uso in CustomersAdmin.tsx (§204). */
export function OnlineOrdersHistory() {
  const [statusFilter, setStatusFilter] = useState<HistoryStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const historyQuery = useQuery({
    queryKey: ['online-orders-history'],
    queryFn: async () => (await api.get<OrderRow[]>('/online-orders/history')).data,
  });

  const filtered = useMemo(() => {
    let rows = historyQuery.data ?? [];
    if (statusFilter !== 'ALL') rows = rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.firstName, r.lastName, r.email, r.phone].join(' ').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [historyQuery.data, statusFilter, search]);

  const paginated = useMemo(
    () => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filtered, page, rowsPerPage],
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h6">Storico ordini online</Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Stato"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as HistoryStatus | 'ALL'); setPage(0); }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="ALL">Tutti</MenuItem>
          <MenuItem value="COMPLETED">Completati</MenuItem>
          <MenuItem value="REJECTED">Rifiutati</MenuItem>
          <MenuItem value="CANCELLED">Annullati</MenuItem>
        </TextField>
        <TextField
          placeholder="Cerca per nome, email o telefono…"
          size="small"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ maxWidth: 420, flex: 1 }}
        />
      </Box>

      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Cliente</TableCell>
              <TableCell>Telefono</TableCell>
              <TableCell>Modalità</TableCell>
              <TableCell>Pagamento</TableCell>
              <TableCell>Orario</TableCell>
              <TableCell align="right">Totale</TableCell>
              <TableCell>Stato</TableCell>
              <TableCell>Loyverse</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginated.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  {order.firstName} {order.lastName}
                  <Typography variant="caption" color="text.secondary" display="block">
                    {order.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  <a href={`tel:${order.phone}`} style={{ color: 'inherit' }}>
                    {order.phone}
                  </a>
                </TableCell>
                <TableCell>
                  {order.fulfillment === 'PICKUP' ? (
                    'Ritiro'
                  ) : (
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        Consegna
                      </Typography>
                      {order.deliveryAddress && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {order.deliveryAddress}
                        </Typography>
                      )}
                      {navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress) && (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<DirectionsIcon sx={{ fontSize: '0.9rem' }} />}
                          component="a"
                          href={navigateUrl(order.deliveryLat, order.deliveryLng, order.deliveryAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ p: 0, minWidth: 'auto', textTransform: 'none', fontSize: '0.75rem' }}
                        >
                          Raggiungi il luogo
                        </Button>
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {order.paymentMethod === 'CARD_ONLINE'
                    ? 'Carta online'
                    : order.paymentMethod === 'CASH'
                      ? (order.fulfillment === 'DELIVERY' ? 'Contanti alla consegna' : 'Contanti')
                      : order.paymentMethod === 'CARD_IN_STORE'
                        ? 'Carta in negozio'
                        : order.fulfillment === 'PICKUP'
                          ? 'Al ritiro'
                          : '—'}
                </TableCell>
                <TableCell>{formatWhen(order.requestedAt)}</TableCell>
                <TableCell align="right">€ {order.total.toFixed(2)}</TableCell>
                <TableCell>
                  <Chip size="small" color={statusColors[order.status]} label={statusLabels[order.status]} />
                </TableCell>
                <TableCell>
                  {order.loyverseReceiptId ? (
                    <Chip size="small" color="success" label="Sincronizzato" />
                  ) : order.loyverseSyncError ? (
                    <Chip size="small" color="error" label={order.loyverseSyncError} />
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
            {paginated.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    Nessun ordine trovato.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          labelRowsPerPage="Righe per pagina"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} di ${count}`}
        />
      </TableContainer>
    </Box>
  );
}
