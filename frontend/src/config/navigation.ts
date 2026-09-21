import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import EventNoteIcon from '@mui/icons-material/EventNote';
import SettingsIcon from '@mui/icons-material/Settings';
import StoreIcon from '@mui/icons-material/Store';
import type { Role } from '../store/authStore';
import { canAccessModule, ModuleKey } from './modules';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: ComponentType<SvgIconProps>;
  description?: string;
  /** Se assente: chiunque abbia un account di locale (non Super Admin). */
  roles?: Role[];
  /** In più, per Manager/Dipendente: governato da Employees.allowedModules. */
  moduleKey?: ModuleKey;
  children?: NavItem[];
}

/**
 * Unica fonte di verità per moduli/pagine del sito: usata dalla Dashboard
 * (tile), dalla barra di navigazione laterale e dalle breadcrumb, così
 * restano sempre coerenti fra loro invece di essere duplicate pagina per
 * pagina.
 */
export const navigation: NavItem[] = [
  {
    key: 'attendance',
    label: 'Presenze',
    path: '/attendance',
    icon: AccessTimeIcon,
    description: 'Timbratura, richieste assenza',
    children: [
      {
        key: 'attendance-leave',
        label: 'Richieste assenza',
        path: '/attendance/leave-requests',
        icon: AccessTimeIcon,
      },
      {
        key: 'attendance-employees',
        label: 'Dipendenti',
        path: '/attendance/employees',
        icon: AccessTimeIcon,
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        key: 'attendance-qr',
        label: 'QR per timbratura',
        path: '/attendance/qr-tokens',
        icon: AccessTimeIcon,
        roles: ['ADMIN'],
      },
      {
        key: 'attendance-clock-in-settings',
        label: 'Metodi di timbratura',
        path: '/attendance/clock-in-settings',
        icon: AccessTimeIcon,
        roles: ['ADMIN'],
      },
      {
        key: 'attendance-records',
        label: 'Storico timbrature',
        path: '/attendance/records',
        icon: AccessTimeIcon,
        roles: ['ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    key: 'haccp',
    label: 'Controlli HACCP',
    path: '/haccp',
    icon: ThermostatIcon,
    description: 'Temperature frigoriferi, report',
    moduleKey: 'haccp',
  },
  {
    key: 'inventory',
    label: 'Inventario e ordini',
    path: '/inventory',
    icon: Inventory2Icon,
    description: 'Prodotti, fornitori, nuovo ordine',
    moduleKey: 'inventory',
    children: [
      {
        key: 'inventory-suppliers',
        label: 'Fornitori',
        path: '/inventory/suppliers',
        icon: Inventory2Icon,
      },
      {
        key: 'inventory-catalog',
        label: 'Categorie e prodotti',
        path: '/inventory/catalog',
        icon: Inventory2Icon,
      },
    ],
  },
  {
    key: 'menu',
    label: 'Menù online',
    path: '/menu/admin',
    icon: RestaurantMenuIcon,
    description: 'Categorie, piatti, disponibilità',
    moduleKey: 'menu',
  },
  {
    key: 'tasks',
    label: 'Attività e scadenze',
    path: '/tasks',
    icon: EventNoteIcon,
    description: 'Pagamenti, visite mediche, attestati',
    moduleKey: 'tasks',
  },
  {
    key: 'settings',
    label: 'Impostazioni locale',
    path: '/settings',
    icon: SettingsIcon,
    description: 'Fasce orarie pranzo/cena, stampanti',
    roles: ['ADMIN'],
  },
  {
    key: 'super-admin-venues',
    label: 'Gestione locali',
    path: '/super-admin/venues',
    icon: StoreIcon,
    roles: ['SUPER_ADMIN'],
  },
];

export function canSeeNavItem(
  user: { role: Role; allowedModules?: string[] } | null | undefined,
  item: NavItem,
): boolean {
  if (!user) return false;
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.moduleKey && !canAccessModule(user, item.moduleKey)) return false;
  return true;
}

export interface BreadcrumbEntry {
  label: string;
  path: string;
}

/** Ricostruisce la catena Home > modulo > sotto-pagina per il path corrente. */
export function getBreadcrumbTrail(pathname: string): BreadcrumbEntry[] {
  const trail: BreadcrumbEntry[] = [{ label: 'Home', path: '/' }];
  for (const item of navigation) {
    if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
      trail.push({ label: item.label, path: item.path });
      const child = item.children?.find(
        (c) => pathname === c.path || pathname.startsWith(`${c.path}/`),
      );
      if (child) trail.push({ label: child.label, path: child.path });
      break;
    }
  }
  return trail;
}
