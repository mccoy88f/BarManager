import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import EventNoteIcon from '@mui/icons-material/EventNote';
import SettingsIcon from '@mui/icons-material/Settings';
import StoreIcon from '@mui/icons-material/Store';
import CampaignIcon from '@mui/icons-material/Campaign';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import PeopleIcon from '@mui/icons-material/People';
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining';
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
  /**
   * Etichetta del primo sotto-voce che punta a `path` stesso (di norma
   * "Panoramica"): da impostare solo quando quella pagina non è una vera
   * panoramica ma qualcos'altro (es. il modulo Ordini apre direttamente la
   * creazione di un nuovo ordine).
   */
  overviewLabel?: string;
}

/**
 * Unica fonte di verità per moduli/pagine del sito: usata dalla Dashboard
 * (tile), dalla barra di navigazione laterale e dalle breadcrumb, così
 * restano sempre coerenti fra loro invece di essere duplicate pagina per
 * pagina.
 */
export const navigation: NavItem[] = [
  {
    key: 'board',
    label: 'Bacheca',
    path: '/board',
    icon: CampaignIcon,
    description: 'Messaggi e avvisi per tutto il personale',
  },
  {
    key: 'kb',
    label: 'KBpedia',
    path: '/kb',
    icon: MenuBookIcon,
    description: 'Guide e procedure interne',
  },
  {
    key: 'attendance',
    label: 'Dipendenti',
    path: '/attendance',
    icon: AccessTimeIcon,
    description: 'Timbratura, richieste assenza',
    children: [
      {
        key: 'attendance-leave',
        label: 'Richieste assenza',
        path: '/attendance/leave-requests',
        icon: AccessTimeIcon,
        description: 'Ferie, permessi, malattia',
      },
      {
        key: 'attendance-employees',
        label: 'Anagrafiche',
        path: '/attendance/employees',
        icon: AccessTimeIcon,
        description: 'Aggiungi, modifica ed elimina gli account del personale',
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        key: 'attendance-qr',
        label: 'Codici QR',
        path: '/attendance/qr-tokens',
        icon: AccessTimeIcon,
        description: 'Genera e scarica i QR delle postazioni per inizio/fine turno',
        roles: ['ADMIN'],
      },
      {
        key: 'attendance-nfc',
        label: 'Tag NFC',
        path: '/attendance/nfc-tags',
        icon: AccessTimeIcon,
        description: 'Censisci i tag NFC delle postazioni per inizio/fine turno',
        roles: ['ADMIN'],
      },
      {
        key: 'attendance-clock-in-settings',
        label: 'Metodi di timbratura',
        path: '/attendance/clock-in-settings',
        icon: AccessTimeIcon,
        description: 'Abilita QR, GPS e/o tag NFC per la timbratura verificata',
        roles: ['ADMIN'],
      },
      {
        key: 'attendance-records',
        label: 'Storico timbrature',
        path: '/attendance/records',
        icon: AccessTimeIcon,
        description: 'Consulta ed esporta le presenze in XLS o PDF',
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
    children: [
      {
        key: 'haccp-temperature',
        label: 'Temperature',
        path: '/haccp/temperature',
        icon: ThermostatIcon,
        description: 'Frigoriferi, rilevazioni giornaliere e storico',
      },
      {
        key: 'haccp-cleaning',
        label: 'Pulizie',
        path: '/haccp/cleaning',
        icon: CleaningServicesIcon,
        description: 'Attività di pulizia e sanificazione',
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Ordini e inventario',
    path: '/inventory',
    icon: Inventory2Icon,
    description: 'Prodotti, fornitori, nuovo ordine',
    moduleKey: 'inventory',
    overviewLabel: 'Nuovo ordine',
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
      {
        key: 'inventory-orders-history',
        label: 'Storico ordini',
        path: '/inventory/orders-history',
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
    children: [
      {
        key: 'menu-settings',
        label: 'Impostazioni Menù',
        path: '/menu/admin/settings',
        icon: RestaurantMenuIcon,
        description: 'Fasce pranzo/cena mostrate nel menù pubblico',
        roles: ['ADMIN'],
      },
    ],
  },
  {
    key: 'tasks',
    label: 'Attività e scadenze',
    path: '/tasks',
    icon: EventNoteIcon,
    description: 'Pagamenti, visite mediche, attestati',
    moduleKey: 'tasks',
    children: [
      {
        key: 'tasks-history',
        label: 'Storico attività',
        path: '/tasks/history',
        icon: EventNoteIcon,
        description: 'Attività completate',
      },
    ],
  },
  {
    key: 'reservations',
    label: 'Prenotazioni',
    path: '/reservations',
    icon: EventSeatIcon,
    description: 'Richieste, tavoli, widget pubblico',
    moduleKey: 'reservations',
    children: [
      {
        key: 'reservations-tables',
        label: 'Tavoli',
        path: '/reservations/tables',
        icon: EventSeatIcon,
      },
      {
        key: 'reservations-settings',
        label: 'Impostazioni prenotazioni',
        path: '/reservations/settings',
        icon: EventSeatIcon,
        roles: ['ADMIN'],
      },
    ],
  },
  {
    key: 'onlineOrders',
    label: 'Ordini online',
    path: '/online-orders',
    icon: DeliveryDiningIcon,
    description: 'Asporto e consegna a domicilio dal menù pubblico',
    moduleKey: 'onlineOrders',
    children: [
      {
        key: 'online-orders-history',
        label: 'Storico ordini online',
        path: '/online-orders/history',
        icon: DeliveryDiningIcon,
        description: 'Ordini conclusi, esito sincronizzazione Loyverse',
      },
      {
        key: 'online-orders-link',
        label: 'Link e QR',
        path: '/online-orders/link',
        icon: DeliveryDiningIcon,
        description: 'Indirizzo e QR code del checkout pubblico /ordina',
        roles: ['ADMIN'],
      },
      {
        key: 'online-orders-settings',
        label: 'Impostazioni ordini online',
        path: '/online-orders/settings',
        icon: DeliveryDiningIcon,
        roles: ['ADMIN'],
      },
    ],
  },
  {
    key: 'customers',
    label: 'Clienti',
    path: '/customers',
    icon: PeopleIcon,
    description: 'Anagrafica clienti da prenotazioni e aggiunti a mano',
    moduleKey: 'customers',
    children: [
      {
        key: 'customers-marketing',
        label: 'Marketing',
        path: '/customers/marketing',
        icon: CampaignIcon,
        description: 'Invia comunicazioni ed email promozionali ai clienti',
      },
      {
        key: 'customers-communications-history',
        label: 'Storico comunicazioni',
        path: '/customers/communications',
        icon: CampaignIcon,
        description: 'Verifica le comunicazioni inviate e il loro stato',
      },
    ],
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
