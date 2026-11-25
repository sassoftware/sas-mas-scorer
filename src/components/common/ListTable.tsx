// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useMemo, useState } from 'react';
import { Loading } from './Loading';
import { MenuButton, MenuItem } from './MenuButton';
import { SearchInput } from './SearchInput';

/*
 * The list pattern every page that lists things to open uses (All Modules,
 * View Flows, Segmentation Trees, Job Monitoring, ...): quick-filter chips and
 * a search box above, then the table in a card. Each column header sorts and
 * has a ⋮ menu (sort, hide the column, show hidden columns); the whole row
 * opens the item, and the first cell carries a real <button> so the keyboard
 * reaches the same action. Further row actions sit in a ⋮ at the row's end.
 */

export type SortDir = 'asc' | 'desc';

export interface ListSort {
  key: string;
  dir: SortDir;
}

/**
 * A filter offered in a column's ⋮ menu: pick one value to show only the rows
 * that have it. The caller filters the rows; the table draws the choices and
 * marks the column while a value is picked.
 */
export interface ListColumnFilter {
  options: { value: string; label?: string; count?: number }[];
  /** The picked value; null shows every row. */
  value: string | null;
  onChange: (value: string | null) => void;
}

export interface ListColumn<T> {
  key: string;
  /** Header text; also names the column in its menu. */
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render: (item: T) => React.ReactNode;
  /** Value to sort by when the caller sorts in the browser (useListSort). */
  sortValue?: (item: T) => string | number | null | undefined;
  /** Sortable without a sortValue (the server sorts). */
  sortable?: boolean;
  /** Direction of the first click; dates read best newest first. */
  firstSortDir?: SortDir;
  /** Hidden until the person shows it from a column menu. */
  defaultHidden?: boolean;
  /** Extra class on the column's cells. */
  className?: string;
  filter?: ListColumnFilter;
}

/** A filter in use, shown as a removable tag beside the chips. */
export interface ActiveFilter {
  label: string;
  value: string;
  onClear: () => void;
}

/** The column filters in use, for ListToolbar's `activeFilters`. */
export function activeColumnFilters<T>(columns: ListColumn<T>[]): ActiveFilter[] {
  return columns.flatMap(c => {
    const f = c.filter;
    if (!f || f.value === null) return [];
    const option = f.options.find(o => o.value === f.value);
    return [{ label: c.label, value: option?.label ?? f.value, onClear: () => f.onChange(null) }];
  });
}

/** Distinct values of a column, most rows first, for a ListColumnFilter. */
export function filterOptions<T>(rows: T[], value: (item: T) => string | null | undefined): ListColumnFilter['options'] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = value(r);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([v, count]) => ({ value: v, count }));
}

const isSortable = <T,>(c: ListColumn<T>) => !!c.sortable || !!c.sortValue;

// ─── Hidden columns, remembered per list in this browser ───

const STORAGE_PREFIX = 'mas-scorer.list-columns.';

function readHidden(storageKey: string | undefined): string[] | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

function writeHidden(storageKey: string | undefined, hidden: string[]) {
  if (!storageKey) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(hidden));
  } catch {
    // Storage blocked or full: the choice lasts for this visit only.
  }
}

// ─── Sorting in the browser ───

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Rows in the order `sort` asks for; empty values always go last. */
export function sortRows<T>(rows: T[], columns: ListColumn<T>[], sort: ListSort | null): T[] {
  const col = sort ? columns.find(c => c.key === sort.key) : undefined;
  if (!sort || !col?.sortValue) return rows;
  const get = col.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    const ea = va === null || va === undefined || va === '';
    const eb = vb === null || vb === undefined || vb === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return collator.compare(String(va), String(vb)) * sign;
  });
}

/** Sort state plus the sorted rows, for lists that sort in the browser. */
export function useListSort<T>(
  rows: T[],
  columns: ListColumn<T>[],
  initial: ListSort | null,
): [T[], ListSort | null, (sort: ListSort) => void] {
  const [sort, setSort] = useState<ListSort | null>(initial);
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  return [sorted, sort, setSort];
}

/**
 * Sort kept in a URL parameter as "key:dir" ("modified:desc"). A bare
 * "asc"/"desc" (the older single-column form) sorts `legacyKey`.
 */
export function parseSortParam(value: string, legacyKey: string): ListSort | null {
  if (value === 'asc' || value === 'desc') return { key: legacyKey, dir: value };
  const [key, dir] = value.split(':');
  if (!key || (dir !== 'asc' && dir !== 'desc')) return null;
  return { key, dir };
}

export const formatSortParam = (sort: ListSort): string => `${sort.key}:${sort.dir}`;

/** Milliseconds of an ISO timestamp, for sortValue; null when missing. */
export const timeValue = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

// ─── Toolbar: chips and search ───

export interface ListChip<V extends string> {
  value: V;
  label: string;
  /** Shown as "(n)"; null while counting. A chip counting 0 is left out unless it is on. */
  count?: number | null;
}

interface ListToolbarProps<V extends string> {
  chips?: ListChip<V>[];
  activeChip?: V;
  onChipChange?: (value: V) => void;
  /** Names the chip group for screen readers ("Filter by type"). */
  chipsLabel?: string;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    ariaLabel: string;
  };
  /** Column filters in use (activeColumnFilters), as removable tags. */
  activeFilters?: ActiveFilter[];
  /** Extra controls between the chips and the search box. */
  children?: React.ReactNode;
}

export function ListToolbar<V extends string>({
  chips,
  activeChip,
  onChipChange,
  chipsLabel = 'Quick filters',
  search,
  activeFilters,
  children,
}: ListToolbarProps<V>) {
  const shown = (chips ?? []).filter((c, i) => i === 0 || c.value === activeChip || c.count !== 0);
  return (
    <div className="list-toolbar">
      {shown.length > 1 && (
        <div className="list-chips" role="group" aria-label={chipsLabel}>
          {shown.map(chip => {
            const on = chip.value === activeChip;
            return (
              <button
                key={chip.value}
                type="button"
                className={`list-chip${on ? ' list-chip--on' : ''}`}
                aria-pressed={on}
                onClick={() => onChipChange?.(chip.value)}
              >
                {chip.label}
                {typeof chip.count === 'number' && <span className="list-chip__count"> ({chip.count})</span>}
              </button>
            );
          })}
        </div>
      )}
      {activeFilters && activeFilters.length > 0 && (
        <div className="list-toolbar__extra" role="group" aria-label="Column filters">
          {activeFilters.map(f => (
            <span key={f.label} className="list-filter-tag">
              <span>{f.label}: <strong>{f.value}</strong></span>
              <button
                type="button"
                className="list-filter-tag__clear"
                aria-label={`Clear filter ${f.label}: ${f.value}`}
                title="Clear filter"
                onClick={f.onClear}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      {children && <div className="list-toolbar__extra">{children}</div>}
      {search && (
        <SearchInput
          className="list-toolbar__search"
          aria-label={search.ariaLabel}
          placeholder={search.placeholder}
          value={search.value}
          onChange={search.onChange}
        />
      )}
    </div>
  );
}

// ─── The table ───

const DOTS = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <circle cx="12" cy="19" r="1.75" />
  </svg>
);

const FUNNEL = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
  </svg>
);

const ARROW_UP = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const ARROW_DOWN = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
);

interface ListTableProps<T> {
  columns: ListColumn<T>[];
  rows: T[];
  rowKey: (item: T) => string;
  /** Names the table for screen readers ("Modules"). */
  label: string;
  /** Remembers hidden columns in this browser under this name. */
  storageKey?: string;
  sort?: ListSort | null;
  onSortChange?: (sort: ListSort) => void;
  /** Opens the item; the whole row reacts, the first cell is a <button>. */
  onRowClick?: (item: T) => void;
  /** Rows this returns false for have nothing to open (no row click, no button). */
  isRowClickable?: (item: T) => boolean;
  /** Extra state for the first cell's button (aria-expanded for a row that expands). */
  rowButtonProps?: (item: T) => React.ButtonHTMLAttributes<HTMLButtonElement>;
  /** Actions beyond opening the row, in a ⋮ menu at the row's end. */
  rowActions?: (item: T) => MenuItem[];
  /** Accessible name of a row's ⋮ menu ("Actions for cars1_0"). */
  rowActionsLabel?: (item: T) => string;
  /** Content shown under a row, across the whole table (an expanded row). */
  renderExpanded?: (item: T) => React.ReactNode;
  rowClassName?: (item: T) => string | undefined;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: React.ReactNode;
}

export function ListTable<T>({
  columns,
  rows,
  rowKey,
  label,
  storageKey,
  sort = null,
  onSortChange,
  onRowClick,
  isRowClickable,
  rowButtonProps,
  rowActions,
  rowActionsLabel,
  renderExpanded,
  rowClassName,
  loading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'Nothing to show.',
}: ListTableProps<T>) {
  const [hidden, setHiddenState] = useState<string[]>(
    () => readHidden(storageKey) ?? columns.filter(c => c.defaultHidden).map(c => c.key)
  );
  const setHidden = useCallback((next: string[]) => {
    setHiddenState(next);
    writeHidden(storageKey, next);
  }, [storageKey]);

  // The first column holds the row's button, so it can't be hidden.
  const visible = columns.filter((c, i) => i === 0 || !hidden.includes(c.key));
  const hiddenCount = columns.length - visible.length;
  const span = visible.length + (rowActions ? 1 : 0);

  const sortBy = (col: ListColumn<T>, dir?: SortDir) => {
    if (!onSortChange) return;
    const next: SortDir = dir
      ?? (sort?.key === col.key ? (sort.dir === 'asc' ? 'desc' : 'asc') : col.firstSortDir ?? 'asc');
    onSortChange({ key: col.key, dir: next });
  };

  const columnMenu = (col: ListColumn<T>, index: number): MenuItem[] => {
    const items: MenuItem[] = [];
    if (isSortable(col) && onSortChange) {
      items.push(
        { id: 'asc', label: 'Sort ascending', onSelect: () => sortBy(col, 'asc'), disabled: sort?.key === col.key && sort.dir === 'asc' },
        { id: 'desc', label: 'Sort descending', onSelect: () => sortBy(col, 'desc'), disabled: sort?.key === col.key && sort.dir === 'desc' },
      );
    }
    const f = col.filter;
    if (f && f.options.length > 0) {
      const group = `Filter by ${col.label.toLowerCase()}`;
      items.push({ id: 'filter:*', label: 'All', group, checked: f.value === null, onSelect: () => f.onChange(null) });
      for (const o of f.options) {
        items.push({
          id: `filter:${o.value}`,
          label: `${o.label ?? o.value}${typeof o.count === 'number' ? ` (${o.count})` : ''}`,
          group,
          checked: f.value === o.value,
          onSelect: () => f.onChange(o.value),
        });
      }
    }
    if (index > 0) {
      items.push({ id: 'hide', label: 'Hide column', onSelect: () => setHidden([...hidden, col.key]) });
    }
    if (hiddenCount > 0) {
      items.push({
        id: 'show',
        label: `Show hidden columns (${hiddenCount})`,
        description: columns.filter(c => !visible.includes(c)).map(c => c.label).join(', '),
        onSelect: () => setHidden([]),
      });
    }
    return items;
  };

  const ariaSort = (col: ListColumn<T>) =>
    sort?.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;

  return (
    <div className="list-card">
      <div className="sas-table__wrapper">
        <table className="sas-table list-table" aria-label={label} aria-busy={loading || undefined}>
          <thead className="list-table__head">
            <tr>
              {visible.map((col, i) => {
                const active = sort?.key === col.key;
                const menu = columnMenu(col, i);
                const filtered = !!col.filter && col.filter.value !== null;
                const mark = filtered && (
                  <span className="list-table__filtered" title="Filtered">
                    {FUNNEL}
                    <span className="sr-only">, filtered</span>
                  </span>
                );
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`list-table__th${col.align ? ` list-table__th--${col.align}` : ''}${filtered ? ' list-table__th--filtered' : ''}`}
                    style={{ width: col.width }}
                    aria-sort={ariaSort(col)}
                  >
                    <div className="list-table__th-inner">
                      {isSortable(col) && onSortChange ? (
                        <button
                          type="button"
                          className={`list-table__sort${active ? ' list-table__sort--active' : ''}`}
                          onClick={() => sortBy(col)}
                        >
                          <span>{col.label}</span>
                          {mark}
                          <span className="list-table__sort-icon">
                            {active && sort?.dir === 'desc' ? ARROW_DOWN : ARROW_UP}
                          </span>
                        </button>
                      ) : (
                        <span className="list-table__label">{col.label}{mark}</span>
                      )}
                      {menu.length > 0 && (
                        <MenuButton
                          floating
                          hideChevron
                          alignEnd
                          label={DOTS}
                          ariaLabel={`${col.label} column options`}
                          title={`${col.label} column options`}
                          triggerClassName="list-table__menu-trigger"
                          items={menu}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="list-table__th list-table__th--actions">
                  <span className="sr-only">More actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr className="sas-table__row">
                <td className="sas-table__td list-table__message" colSpan={span}>
                  <Loading size="small" message={loadingMessage} />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr className="sas-table__row">
                <td className="sas-table__td list-table__message" colSpan={span}>{emptyMessage}</td>
              </tr>
            )}
            {rows.map(item => {
              const key = rowKey(item);
              const expanded = renderExpanded?.(item);
              const extra = rowClassName?.(item);
              const open = onRowClick && (isRowClickable?.(item) ?? true) ? onRowClick : undefined;
              const actions = rowActions?.(item);
              return (
                <React.Fragment key={key}>
                  <tr
                    className={`sas-table__row${open ? ' sas-table__row--clickable' : ''}${extra ? ` ${extra}` : ''}`}
                    onClick={open ? () => open(item) : undefined}
                  >
                    {visible.map((col, i) => {
                      const content = col.render(item);
                      return (
                        <td
                          key={col.key}
                          className={`sas-table__td list-table__td${col.align ? ` list-table__td--${col.align}` : ''}${col.className ? ` ${col.className}` : ''}`}
                        >
                          {open && i === 0 ? (
                            <button
                              type="button"
                              className="sas-table__row-button"
                              {...rowButtonProps?.(item)}
                              onClick={(e) => {
                                e.stopPropagation(); // the <tr> handler would fire a second time
                                open(item);
                              }}
                            >
                              {content}
                            </button>
                          ) : content}
                        </td>
                      );
                    })}
                    {rowActions && (
                      // Clicks inside the menu must not open the row.
                      <td className="sas-table__td list-table__td--actions" onClick={(e) => e.stopPropagation()}>
                        {actions && actions.length > 0 && <MenuButton
                          floating
                          hideChevron
                          alignEnd
                          label={DOTS}
                          ariaLabel={rowActionsLabel?.(item) ?? 'More actions'}
                          title="More actions"
                          triggerClassName="list-table__menu-trigger"
                          items={actions}
                        />}
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr className="list-table__expanded">
                      <td colSpan={span}>{expanded}</td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ListTable;
