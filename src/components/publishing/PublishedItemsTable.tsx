// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PublishedItem, PublishedKind } from '../../types/modelPublish';
import { Badge, BadgeVariant } from '../common/Badge';
import { MenuItem } from '../common/MenuButton';
import {
  ListChip, ListColumn, ListSort, ListTable, ListToolbar, activeColumnFilters, filterOptions, sortRows, timeValue,
} from '../common/ListTable';
import { Pagination } from '../common/Pagination';
import {
  extractDecisionFlowId,
  getPublishedKind,
} from '../../utils/publishHelpers';
import { buildDeepLink } from '../../utils/deepLinks';
import { formatTimestamp } from '../../utils/formatters';

type KindFilter = 'all' | PublishedKind;

/** Rows rendered per page; the filters and counts still cover the whole list. */
const PAGE_SIZE = 25;

interface PublishedItemsTableProps {
  items: PublishedItem[];
  onNavigateToModule: (moduleId: string) => void;
  onNavigateToFlow: (flowId: string) => void;
  /**
   * The Destination column filter, when the page sets it too (a
   * destination's "Show its deployed items"). Unset, the table keeps its own.
   */
  destinationFilter?: string | null;
  onDestinationFilterChange?: (value: string | null) => void;
}

const kindVariant = (kind: PublishedKind): BadgeVariant => {
  if (kind === 'model') return 'info';
  if (kind === 'decision') return 'success';
  return 'default';
};

const kindLabel = (kind: PublishedKind): string => {
  if (kind === 'model') return 'Model';
  if (kind === 'decision') return 'Decision';
  return 'Other';
};

interface Row {
  id: string;
  item: PublishedItem;
  kind: PublishedKind;
}

const COLUMNS: ListColumn<Row>[] = [
  {
    key: 'name',
    label: 'Name',
    width: '26%',
    sortValue: ({ item }) => item.publishName,
    // Inline wrapper: ListTable puts the first column inside a <button>.
    render: ({ item }) => (
      <span className="list-cell">
        <span className="list-cell__main">{item.publishName}</span>
        {item.name !== item.publishName && <span className="list-cell__sub">{item.name}</span>}
      </span>
    ),
  },
  {
    key: 'destination',
    label: 'Destination',
    width: '15%',
    sortValue: ({ item }) => item.destinationName,
    render: ({ item }) => item.destinationName,
  },
  {
    key: 'kind',
    label: 'Kind',
    width: '10%',
    sortValue: ({ kind }) => kindLabel(kind),
    render: ({ kind }) => <Badge variant={kindVariant(kind)} size="small">{kindLabel(kind)}</Badge>,
  },
  {
    key: 'codeType',
    label: 'Code type',
    width: '11%',
    sortValue: ({ item }) => item.codeType,
    render: ({ item }) => item.codeType ?? '',
  },
  {
    key: 'createdBy',
    label: 'Published by',
    width: '13%',
    sortValue: ({ item }) => item.createdBy,
    render: ({ item }) => item.createdBy ?? '',
  },
  {
    key: 'published',
    label: 'Published',
    width: '17%',
    firstSortDir: 'desc',
    sortValue: ({ item }) => timeValue(item.creationTimeStamp),
    render: ({ item }) => <span className="list-nowrap">{formatTimestamp(item.creationTimeStamp)}</span>,
  },
];

export const PublishedItemsTable: React.FC<PublishedItemsTableProps> = ({
  items,
  onNavigateToModule,
  onNavigateToFlow,
  destinationFilter: controlledDestination,
  onDestinationFilterChange,
}) => {
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [ownDestination, setOwnDestination] = useState<string | null>(null);
  const controlled = controlledDestination !== undefined;
  const destinationFilter = controlled ? controlledDestination : ownDestination;
  const setDestinationFilter = useCallback((value: string | null) => {
    if (!controlled) setOwnDestination(value);
    onDestinationFilterChange?.(value);
  }, [controlled, onDestinationFilterChange]);
  const [codeTypeFilter, setCodeTypeFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<ListSort | null>({ key: 'published', dir: 'desc' });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 200);
    return () => clearTimeout(timer);
  }, [searchText]);

  // A changed filter or search term starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, kindFilter, destinationFilter, codeTypeFilter, sort]);

  const enrichedItems = useMemo<Row[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        item,
        kind: getPublishedKind(item.sourceUri),
      })),
    [items]
  );

  // Search narrows the list. Each filter's choices are counted with every
  // other filter applied, so a count says how many rows picking it would show.
  const searched = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return enrichedItems;
    return enrichedItems.filter(({ item, kind }) =>
      [item.publishName, item.name, kindLabel(kind), item.codeType ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [enrichedItems, debouncedSearch]);

  /** Whether a row passes every filter except `skip`. */
  const passes = useCallback((r: Row, skip?: 'kind' | 'destination' | 'codeType') =>
    (skip === 'kind' || kindFilter === 'all' || r.kind === kindFilter)
    && (skip === 'destination' || destinationFilter === null || r.item.destinationName === destinationFilter)
    && (skip === 'codeType' || codeTypeFilter === null || r.item.codeType === codeTypeFilter),
  [kindFilter, destinationFilter, codeTypeFilter]);

  const forChips = searched.filter(r => passes(r, 'kind'));
  const chips: ListChip<KindFilter>[] = (['all', 'decision', 'model', 'unknown'] as const).map(value => ({
    value,
    label: value === 'all' ? 'All' : kindLabel(value),
    count: value === 'all' ? forChips.length : forChips.filter(r => r.kind === value).length,
  }));

  const columns = useMemo<ListColumn<Row>[]>(() => COLUMNS.map(c => {
    if (c.key === 'destination') {
      return {
        ...c,
        filter: {
          options: filterOptions(searched.filter(r => passes(r, 'destination')), r => r.item.destinationName),
          value: destinationFilter,
          onChange: setDestinationFilter,
        },
      };
    }
    if (c.key === 'codeType') {
      return {
        ...c,
        filter: {
          options: filterOptions(searched.filter(r => passes(r, 'codeType')), r => r.item.codeType),
          value: codeTypeFilter,
          onChange: setCodeTypeFilter,
        },
      };
    }
    return c;
  }), [searched, passes, destinationFilter, setDestinationFilter, codeTypeFilter]);

  const filtered = useMemo(() => searched.filter(r => passes(r)), [searched, passes]);

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  // Clamp rather than only reset so a shrinking list never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [sorted, currentPage]
  );

  /** What a row opens: the module's page for a MAS module, else the decision's flow. */
  const openRow = (row: Row): (() => void) | null => {
    if (row.item.destination?.destinationType === 'microAnalyticService') {
      return () => onNavigateToModule(row.item.publishName);
    }
    const flowId = extractDecisionFlowId(row.item.sourceUri);
    return flowId ? () => onNavigateToFlow(flowId) : null;
  };

  const rowActions = (row: Row): MenuItem[] => {
    const { item, kind } = row;
    const items: MenuItem[] = [];
    if (item.destination?.destinationType === 'microAnalyticService') {
      items.push({ id: 'module', label: 'Open module', onSelect: () => onNavigateToModule(item.publishName) });
    }
    const flowId = extractDecisionFlowId(item.sourceUri);
    if (flowId) {
      items.push({ id: 'flow', label: 'View flow diagram', onSelect: () => onNavigateToFlow(flowId) });
    }
    const deeplink = kind === 'model' || kind === 'decision' ? buildDeepLink(kind, item.sourceUri) : null;
    if (deeplink) {
      items.push({
        id: 'open',
        label: deeplink.label,
        description: 'Opens in a new window',
        onSelect: () => { window.open(deeplink.url, '_blank', 'noopener,noreferrer'); },
      });
    }
    return items;
  };

  return (
    <div className="list-page">
      <ListToolbar
        chips={chips}
        activeChip={kindFilter}
        onChipChange={setKindFilter}
        chipsLabel="Filter by kind"
        search={{
          value: searchText,
          onChange: setSearchText,
          placeholder: 'Search name or code type',
          ariaLabel: 'Search published items by name, kind, or code type',
        }}
        activeFilters={activeColumnFilters(columns)}
      />

      <ListTable
        label="Published models and decisions"
        storageKey="published"
        columns={columns}
        rows={pageItems}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        onRowClick={(r) => openRow(r)?.()}
        isRowClickable={(r) => openRow(r) !== null}
        rowActions={rowActions}
        rowActionsLabel={(r) => `More actions for ${r.item.publishName}`}
        emptyMessage="No published items match the current filters."
      />

      {pageCount > 1 && (
        <Pagination
          label="Published items pages"
          page={currentPage + 1}
          totalPages={pageCount}
          pageSize={PAGE_SIZE}
          totalItems={sorted.length}
          onPageChange={(p) => setPage(p - 1)}
        />
      )}
    </div>
  );
};

export default PublishedItemsTable;
