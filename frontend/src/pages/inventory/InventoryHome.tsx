import { Box, Button } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate } from 'react-router-dom';
import { NewOrder } from './NewOrder';

// Home del modulo inventario: v1 espone direttamente il flusso "nuovo
// ordine"; le schermate di gestione categorie/prodotti usano gli stessi
// endpoint REST e vanno aggiunte nella Fase 1 della roadmap.
export function InventoryHome() {
  const navigate = useNavigate();
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          startIcon={<SettingsIcon />}
          onClick={() => navigate('/inventory/suppliers')}
        >
          Fornitori
        </Button>
      </Box>
      <NewOrder />
    </Box>
  );
}
