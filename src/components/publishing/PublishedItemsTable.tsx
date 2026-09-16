// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { PublishedItem, PublishedKind } from '../../types/modelPublish';
import { DataTable, Column } from '../common/DataTable';
import { Badge, BadgeVariant } from '../common/Badge';
import { SearchInput } from '../common/SearchInput';
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
}

const kindVariant = (kind: PublishedKind): BadgeVariant => {
  if (kind === 'model') return 'info';
  if (kind === 'decision') return 'success';
  return 'default';
};

const kindLabel = (kind: PublishedKind): string => {
  if (kind === 'model') return 'Model';
  if (kind === 'decision') return 'Decision';
  return 'Unknown';
};

export const PublishedItemsTable: React.FC<PublishedItemsTableProps> = ({
  items,
  onNavigateToModule,
  onNavigateToFlow,
}) => {
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [destinationFilter, setDestinationFilter] = useState<string>('all');
  const [codeTypeFilter, setCodeTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 200);
    return () => clearTimeout(timer);
  }, [searchText]);

  // A changed filter or search term starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, kindFilter, destinationFilter, codeTypeFilter]);

  const destinations = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) s.add(i.destinationName);
    return Array.from(s).sort();
  }, [items]);

  const codeTypes = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) if (i.codeType) s.add(i.codeType);
    return Array.from(s).sort();
  }, [items]);

  interface Row {
    id: string;
    item: PublishedItem;
    kind: PublishedKind;
  }

  const enrichedItems = useMemo<Row[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        item,
        kind: getPublishedKind(item.sourceUri),
      })),
    [items]
  );

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return enrichedItems.filter(({ item, kind }) => {
      if (kindFilter !== 'all' && kind !== kindFilter) return false;
      if (destinationFilter !== 'all' && item.destinationName !== destinationFilter) return false;
      if (codeTypeFilter !== 'all' && item.codeType !== codeTypeFilter) return false;

      if (!term) return true;
      const haystack = [
        item.publishName,
        item.name,
        kindLabel(kind),
        item.codeType ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [enrichedItems, debouncedSearch, kindFilter, destinationFilter, codeTypeFilter]);

  // Clamp rather than only reset so a shrinking list never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filtered, currentPage]
  );

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '22%',
      render: ({ item }) => (
        <div className="publishing__name-cell">
          <span className="publishing__name-main">{item.publishName}</span>
          {item.name !== item.publishName && (
            <span className="publishing__name-sub">{item.name}</span>
          )}
        </div>
      ),
    },
    {
      key: 'destination',
      header: 'Destination',
      width: '14%',
      render: ({ item }) => <span>{item.destinationName}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      width: '9%',
      render: ({ kind }) => <Badge variant={kindVariant(kind)} size="small">{kindLabel(kind)}</Badge>,
    },
    {
      key: 'codeType',
      header: 'Code Type',
      width: '9%',
      render: ({ item }) => <span>{item.codeType ?? ''}</span>,
    },
    {
      key: 'createdBy',
      header: 'Creator',
      width: '12%',
      render: ({ item }) => <span>{item.createdBy ?? ''}</span>,
    },
    {
      key: 'creationTimeStamp',
      header: 'Created',
      width: '14%',
      render: ({ item }) => (
        <span className="publishing__date">{formatTimestamp(item.creationTimeStamp)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '12%',
      align: 'center',
      render: ({ item, kind }) => {
        const deeplink =
          kind === 'model' || kind === 'decision'
            ? buildDeepLink(kind, item.sourceUri)
            : null;
        const flowId = extractDecisionFlowId(item.sourceUri);
        const isMas = item.destination?.destinationType === 'microAnalyticService';

        return (
          <div className="publishing__actions">
            {flowId && (
              <a
                href={`#/flows/${flowId}`}
                className="sas-deep-link"
                title="View Flow Diagram"
                aria-label={`View flow diagram for ${item.publishName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onNavigateToFlow(flowId);
                }}
              >
                <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="6" cy="19" r="2" />
                  <circle cx="18" cy="19" r="2" />
                  <path d="M12 7v4M12 11l-6 6M12 11l6 6" />
                </svg>
              </a>
            )}
            {deeplink && (
              <a
                href={deeplink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="sas-deep-link"
                title={deeplink.label}
                aria-label={`${deeplink.label}: ${item.publishName}`}
                onClick={(e) => e.stopPropagation()}
              >
                <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
            {isMas && (
              <button
                type="button"
                className="sas-deep-link"
                title="Execute Score"
                aria-label={`Execute score for ${item.publishName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToModule(item.publishName);
                }}
              >
                <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="publishing__items">
      <div className="publishing__items-toolbar">
        <div className="publishing__items-filters">
          <label className="publishing__filter">
            <span className="publishing__filter-label">Kind:</span>
            <select
              className="publishing__filter-select"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            >
              <option value="all">All</option>
              <option value="model">Model</option>
              <option value="decision">Decision</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="publishing__filter">
            <span className="publishing__filter-label">Destination:</span>
            <select
              className="publishing__filter-select"
              value={destinationFilter}
              onChange={(e) => setDestinationFilter(e.target.value)}
            >
              <option value="all">All</option>
              {destinations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="publishing__filter">
            <span className="publishing__filter-label">Code Type:</span>
            <select
              className="publishing__filter-select"
              value={codeTypeFilter}
              onChange={(e) => setCodeTypeFilter(e.target.value)}
            >
              <option value="all">All</option>
              {codeTypes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <SearchInput
          className="publishing__search"
          aria-label="Search published items by name, kind, or code type"
          placeholder="Search name, kind, or code type..."
          value={searchText}
          onChange={setSearchText}
        />
      </div>

      <div className="publishing__items-count">
        {filtered.length === items.length
          ? `${items.length} published items`
          : `Filtered to ${filtered.length} of ${items.length} published items`}
      </div>

      <DataTable
        columns={columns}
        data={pageItems}
        keyField="id"
        emptyMessage="No published items match the current filters."
      />

      {pageCount > 1 && (
        <Pagination
          label="Published items pages"
          page={currentPage + 1}
          totalPages={pageCount}
          pageSize={PAGE_SIZE}
          totalItems={filtered.length}
          onPageChange={(p) => setPage(p - 1)}
        />
      )}
    </div>
  );
};

export default PublishedItemsTable;
