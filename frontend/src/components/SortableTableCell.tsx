import { TableCell, TableSortLabel } from '@mui/material';
import type { ReactNode } from 'react';
import type { SortOrder } from '../hooks/useTableSort';

interface SortableTableCellProps<K extends string> {
  columnKey: K;
  label: ReactNode;
  orderBy: K | null;
  order: SortOrder;
  onSort: (key: K) => void;
  align?: 'left' | 'right' | 'center';
}

/** Intestazione di colonna ordinabile, condivisa da tutte le tabelle del sito. */
export function SortableTableCell<K extends string>({
  columnKey,
  label,
  orderBy,
  order,
  onSort,
  align,
}: SortableTableCellProps<K>) {
  const active = orderBy === columnKey;
  return (
    <TableCell align={align} sortDirection={active ? order : false}>
      <TableSortLabel active={active} direction={active ? order : 'asc'} onClick={() => onSort(columnKey)}>
        {label}
      </TableSortLabel>
    </TableCell>
  );
}
