import { useMemo, useState } from 'react';

export type SortOrder = 'asc' | 'desc';
export type SortValue = string | number | Date | null | undefined;

/**
 * Ordinamento client-side per colonna, condiviso da tutte le tabelle del
 * sito (ricerca + filtri + ordinamento per colonna di default su ogni
 * tabella). `accessors` mappa ogni chiave di colonna ordinabile alla
 * funzione che estrae il valore comparabile da una riga: lascia a ogni
 * pagina la libertà di decidere cosa è ordinabile, senza imporre una
 * forma di riga o di colonna rigida.
 */
export function useTableSort<T, K extends string>(
  rows: T[],
  accessors: Partial<Record<K, (row: T) => SortValue>>,
  initial?: { key: K; order?: SortOrder },
) {
  const [orderBy, setOrderBy] = useState<K | null>(initial?.key ?? null);
  const [order, setOrder] = useState<SortOrder>(initial?.order ?? 'asc');

  const toggleSort = (key: K) => {
    if (orderBy === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(key);
      setOrder('asc');
    }
  };

  const sortedRows = useMemo(() => {
    const accessor = orderBy ? accessors[orderBy] : undefined;
    if (!accessor) return rows;
    const sorted = [...rows].sort((a, b) => compareValues(accessor(a), accessor(b)));
    return order === 'asc' ? sorted : sorted.reverse();
  }, [rows, orderBy, order, accessors]);

  return { sortedRows, orderBy, order, toggleSort };
}

function compareValues(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as Date | string).getTime() - new Date(b as Date | string).getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'it', { sensitivity: 'base', numeric: true });
}
