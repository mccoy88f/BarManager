import { Box, Button, Stack } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import CategoryIcon from '@mui/icons-material/Category';
import { useNavigate } from 'react-router-dom';
import { NewOrder } from './NewOrder';

export function InventoryHome() {
  const navigate = useNavigate();
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          startIcon={<CategoryIcon />}
          onClick={() => navigate('/inventory/catalog')}
        >
          Categorie e prodotti
        </Button>
        <Button
          size="small"
          startIcon={<SettingsIcon />}
          onClick={() => navigate('/inventory/suppliers')}
        >
          Fornitori
        </Button>
      </Stack>
      <NewOrder />
    </Box>
  );
}
