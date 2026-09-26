import { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Container,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Breadcrumbs,
  Link as MuiLink,
  Menu,
  MenuItem,
  Divider,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Outlet, useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';
import { navigation, canSeeNavItem, getBreadcrumbTrail } from '../config/navigation';
import { APP_VERSION } from '../version';

const DRAWER_WIDTH = 260;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const venueName = useAuthStore((s) => s.venueName);

  // Il nome mostrato in alto viene aggiornato appena si salva un cambio in
  // Impostazioni (che invalida questa stessa query): senza, restava quello
  // di login finché non si usciva e si rientrava. Non per SUPER_ADMIN, che
  // non ha un locale proprio e per cui l'endpoint non è comunque accessibile.
  const venueQuery = useQuery({
    queryKey: ['venue-me'],
    queryFn: async () => (await api.get<{ name: string }>('/venues/me')).data,
    enabled: user?.role === 'ADMIN' || user?.role === 'MANAGER',
    staleTime: 60_000,
  });
  const displayVenueName = venueQuery.data?.name ?? venueName;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(
    navigation.find((item) => location.pathname.startsWith(item.path))?.key ?? null,
  );

  const visibleItems = navigation.filter((item) => canSeeNavItem(user, item));
  const breadcrumbs = getBreadcrumbTrail(location.pathname);

  const goTo = (path: string) => {
    navigate(path);
    if (!isDesktop) setMobileOpen(false);
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
    <List sx={{ pt: 1, flexGrow: 1, overflowY: 'auto' }}>
      <ListItemButton selected={location.pathname === '/'} onClick={() => goTo('/')}>
        <ListItemIcon>
          <HomeIcon />
        </ListItemIcon>
        <ListItemText primary="Home" />
      </ListItemButton>

      {visibleItems.map((item) => {
        const visibleChildren = item.children?.filter((c) => canSeeNavItem(user, c)) ?? [];
        const hasChildren = visibleChildren.length > 0;
        const isActive = location.pathname.startsWith(item.path);
        const isExpanded = expandedKey === item.key || isActive;

        return (
          <Box key={item.key}>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() =>
                hasChildren
                  ? setExpandedKey(isExpanded ? null : item.key)
                  : goTo(item.path)
              }
            >
              <ListItemIcon>
                <item.icon />
              </ListItemIcon>
              <ListItemText primary={item.label} />
              {hasChildren && (isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />)}
            </ListItemButton>
            {hasChildren && (
              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  <ListItemButton
                    sx={{ pl: 4 }}
                    selected={location.pathname === item.path}
                    onClick={() => goTo(item.path)}
                  >
                    <ListItemText primary={item.overviewLabel ?? 'Panoramica'} />
                  </ListItemButton>
                  {visibleChildren.map((child) => (
                    <ListItemButton
                      key={child.key}
                      sx={{ pl: 4 }}
                      selected={location.pathname === child.path}
                      onClick={() => goTo(child.path)}
                    >
                      <ListItemText primary={child.label} />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            )}
          </Box>
        );
      })}
    </List>
    <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {APP_VERSION}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        Crediti: creato da{' '}
        <MuiLink href="https://github.com/mccoy88f" target="_blank" rel="noopener noreferrer">
          Mccoy88f
        </MuiLink>
      </Typography>
    </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="primary"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar>
          {user && user.role !== 'SUPER_ADMIN' && (
            <IconButton
              color="inherit"
              edge="start"
              sx={{ mr: 2, display: { md: 'none' } }}
              onClick={() => setMobileOpen((o) => !o)}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography
            variant="h6"
            sx={{ flexGrow: 1, cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            {displayVenueName || 'Bar Management'}
          </Typography>
          {user && (
            <>
              <IconButton
                color="inherit"
                onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                aria-label="Account"
              >
                <AccountCircleIcon />
              </IconButton>
              <Menu
                anchorEl={userMenuAnchor}
                open={!!userMenuAnchor}
                onClose={() => setUserMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem disabled sx={{ opacity: 1 }}>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {user.email}
                  </Typography>
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setUserMenuAnchor(null);
                    navigate('/account');
                  }}
                >
                  <ListItemIcon>
                    <PersonIcon fontSize="small" />
                  </ListItemIcon>
                  Il mio profilo
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setUserMenuAnchor(null);
                    logout();
                    navigate('/login');
                  }}
                >
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  Esci
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      {user && user.role !== 'SUPER_ADMIN' && (
        <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
          <Drawer
            variant={isDesktop ? 'permanent' : 'temporary'}
            open={isDesktop ? true : mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
            }}
          >
            <Toolbar />
            {drawerContent}
          </Drawer>
        </Box>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          // Un elemento flex (questo Box lo è, del flex container root subito
          // sopra) ha di default `min-width: auto`, che per lo spec CSS
          // equivale al min-content del contenuto — calcolato attraversando
          // qualunque discendente block "normale" (senza fermarsi a un
          // `maxWidth` in percentuale, ignorato in questa fase). Una singola
          // pagina con una tabella larga (es. molte colonne) può quindi
          // "spingere" questo Box oltre i 100vw anche su mobile, allargando
          // l'intera pagina — bug riprodotto su una nuova pagina (Storico
          // comunicazioni) nonostante il suo TableContainer avesse già
          // `overflowX: 'auto'`. `minWidth: 0` rimuove il vincolo, lasciando
          // che sia il singolo TableContainer/overflow interno a gestire lo
          // scroll orizzontale, come previsto, invece di allargare la pagina.
          minWidth: 0,
          width: { md: user && user.role !== 'SUPER_ADMIN' ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%' },
        }}
      >
        <Toolbar />
        <Container maxWidth="md" sx={{ py: 3 }}>
          {breadcrumbs.length > 1 && (
            <Breadcrumbs sx={{ mb: 2 }}>
              {breadcrumbs.map((crumb, index) =>
                index === breadcrumbs.length - 1 ? (
                  <Typography key={crumb.path} color="text.primary" variant="body2">
                    {crumb.label}
                  </Typography>
                ) : (
                  <MuiLink
                    key={crumb.path}
                    component={RouterLink}
                    to={crumb.path}
                    underline="hover"
                    color="inherit"
                    variant="body2"
                  >
                    {crumb.label}
                  </MuiLink>
                ),
              )}
            </Breadcrumbs>
          )}
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
