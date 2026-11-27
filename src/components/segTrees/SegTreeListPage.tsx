// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAllSegmentationTrees, type SegmentationTreeSummary } from '../../api/segmentationTrees';
import { formatTimestamp } from '../../utils/formatters';
import { parsePageParam, useDebouncedUrlText, useListUrlParams } from '../../utils/listUrlState';
import { registerViewCache } from '../../utils/viewCaches';
import { Alert, Button, Pagination } from '../common';
import {
  ListChip, ListColumn, ListSort, ListTable, ListToolbar,
  activeColumnFilters, filterOptions, formatSortParam, parseSortParam, sortRows, timeValue,
} from '../common/ListTable';
import { PageHeader } from '../layout/Layout';
import { useCurrentUserId } from '../../hooks/useCurrentUser';

const PAGE_SIZE = 20;

type TreeFilter = 'all' | 'mine' | 'recent';

/** "Changed recently" reaches back this far. */
const RECENT_DAYS = 30;

// Search, sort, filter and page live in the URL
// (#/segmentation-trees?q=…&sort=modified:desc&show=mine&page=2), so Back
// from a tree, a reload or a shared link shows the same view.
const LIST_DEFAULTS = { q: '', sort: 'name:asc', show: 'all', by: '', page: '1' };

// The collection from the last visit. Coming back from a tree shows it at
// once (the trees endpoint can be slow); it is fetched again in the
// background only when older than CACHE_FRESH_MS. Dropped on logout and
// connection switch.
const CACHE_FRESH_MS = 60_000;
let cachedTrees: { items: SegmentationTreeSummary[]; fetchedAt: number } | null = null;

registerViewCache('segTreeList', () => {
  cachedTrees = null;
});

const BASE_COLUMNS: ListColumn<SegmentationTreeSummary>[] = [
  {
    key: 'name',
    label: 'Name',
    width: '30%',
    sortValue: (t) => t.name,
    render: (t) => <span className="list-cell__main">{t.name}</span>,
  },
  {
    key: 'description',
    label: 'Description',
    sortValue: (t) => t.description,
    render: (t) => <span className="list-clamp">{t.description}</span>,
  },
  {
    key: 'createdBy',
    label: 'Created by',
    width: '13%',
    defaultHidden: true,
    sortValue: (t) => t.createdBy,
    render: (t) => t.createdBy,
  },
  {
    key: 'modifiedBy',
    label: 'Modified by',
    width: '13%',
    sortValue: (t) => t.modifiedBy,
    render: (t) => t.modifiedBy,
  },
  {
    key: 'modified',
    label: 'Modified',
    width: '18%',
    firstSortDir: 'desc',
    sortValue: (t) => timeValue(t.modifiedTimeStamp),
    render: (t) => <span className="list-nowrap">{formatTimestamp(t.modifiedTimeStamp)}</span>,
  },
];

export default function SegTreeListPage() {
  const navigate = useNavigate();
  const [allTrees, setAllTrees] = useState<SegmentationTreeSummary[]>(() => cachedTrees?.items ?? []);
  const [params, updateParams] = useListUrlParams('segtrees', LIST_DEFAULTS);
  const sort: ListSort = useMemo(
    () => parseSortParam(params.sort, 'name') ?? { key: 'name', dir: 'asc' },
    [params.sort]
  );
  const show: TreeFilter = params.show === 'mine' || params.show === 'recent' ? params.show : 'all';
  // 1-based, the page number <Pagination> speaks.
  const page = parsePageParam(params.page);
  // The box filters at once; the URL catches up when typing pauses.
  const commitSearch = useCallback((q: string) => updateParams({ q }), [updateParams]);
  const [search, setSearchText] = useDebouncedUrlText(params.q, commitSearch);
  const setSearch = (value: string) => {
    setSearchText(value);
    if (page !== 1) updateParams({ page: '1' });
  };
  const setPage = (next: number) => updateParams({ page: String(next) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Bumped by Refresh and the alert's Retry button to re-run the load below.
  const [reloadToken, setReloadToken] = useState(0);
  const me = useCurrentUserId();

  // The whole collection is fetched once; search, filter and sort run in memory.
  useEffect(() => {
    const cached = cachedTrees;
    if (reloadToken === 0 && cached && Date.now() - cached.fetchedAt < CACHE_FRESH_MS) return;
    let active = true;
    // With a list already on screen the refetch is silent.
    if (!cached || reloadToken > 0) setLoading(true);
    setError('');
    listAllSegmentationTrees()
      .then((items) => {
        cachedTrees = { items, fetchedAt: Date.now() };
        if (active) setAllTrees(items);
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadToken]);

  const modifiedBy = params.by || null;

  const textMatched = useMemo(() => {
    if (!search.trim()) return allTrees;
    const term = search.trim().toLowerCase();
    return allTrees.filter((t) =>
      (t.name ?? '').toLowerCase().includes(term) ||
      (t.description ?? '').toLowerCase().includes(term),
    );
  }, [allTrees, search]);

  // The Modified by filter (in that column's menu) applies before the chips count.
  const searched = useMemo(
    () => (modifiedBy ? textMatched.filter(t => t.modifiedBy === modifiedBy) : textMatched),
    [textMatched, modifiedBy]
  );

  const { mine, recent } = useMemo(() => {
    const since = Date.now() - RECENT_DAYS * 86_400_000;
    return {
      mine: me ? searched.filter(t => t.createdBy === me) : [],
      recent: searched.filter(t => (timeValue(t.modifiedTimeStamp) ?? 0) >= since),
    };
  }, [searched, me]);

  const chips: ListChip<TreeFilter>[] = [
    { value: 'all', label: 'All', count: searched.length },
    // Offered once the signed-in user is known.
    ...(me || show === 'mine' ? [{ value: 'mine' as const, label: 'Created by me', count: me ? mine.length : null }] : []),
    { value: 'recent', label: `Changed in the last ${RECENT_DAYS} days`, count: recent.length },
  ];

  const filtered = show === 'mine' ? mine : show === 'recent' ? recent : searched;

  const columns = useMemo<ListColumn<SegmentationTreeSummary>[]>(() => {
    const since = Date.now() - RECENT_DAYS * 86_400_000;
    const inChip = (t: SegmentationTreeSummary) =>
      show === 'mine' ? !!me && t.createdBy === me
        : show === 'recent' ? (timeValue(t.modifiedTimeStamp) ?? 0) >= since
          : true;
    return BASE_COLUMNS.map(c => c.key !== 'modifiedBy' ? c : {
      ...c,
      filter: {
        options: filterOptions(textMatched.filter(inChip), t => t.modifiedBy),
        value: modifiedBy,
        onChange: (v: string | null) => updateParams({ by: v ?? '', page: '1' }),
      },
    });
  }, [textMatched, show, me, modifiedBy, updateParams]);

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  const total = sorted.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const displayTrees = useMemo(() => {
    const start = (Math.min(page, Math.max(1, totalPages)) - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page, totalPages]);

  return (
    <div className="list-page">
      <PageHeader
        title="Segmentation Trees"
        count={loading && allTrees.length === 0 ? undefined : `${total} tree${total !== 1 ? 's' : ''}`}
        actions={
          <Button variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
            Refresh
          </Button>
        }
      />

      <ListToolbar
        chips={chips}
        activeChip={show}
        onChipChange={(v) => updateParams({ show: v, page: '1' })}
        chipsLabel="Filter segmentation trees"
        activeFilters={activeColumnFilters(columns)}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search name or description',
          ariaLabel: 'Search segmentation trees by name or description',
        }}
      />

      {error && (
        <Alert
          variant="error"
          actions={
            <Button variant="secondary" size="small" onClick={() => setReloadToken((t) => t + 1)}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <ListTable
        label="Segmentation trees"
        storageKey="segtrees"
        columns={columns}
        rows={displayTrees}
        rowKey={(t) => t.id}
        sort={sort}
        onSortChange={(s) => updateParams({ sort: formatSortParam(s), page: '1' })}
        onRowClick={(t) => navigate(`/segmentation-trees/${t.id}`)}
        loading={loading}
        loadingMessage="Loading segmentation trees..."
        emptyMessage={
          show === 'mine' && !me ? 'Looking up who is signed in…'
            : search ? 'No segmentation trees match your search.'
              : show !== 'all' || modifiedBy ? 'No segmentation trees match this filter.'
                : 'No segmentation trees found.'
        }
      />

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={total}
          label="Segmentation tree list pages"
        />
      )}
    </div>
  );
}
