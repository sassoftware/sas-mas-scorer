// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listAllDecisions } from '../../api/decisions';
import type { DecisionFlow } from '../../types/sid';
import { formatTimestamp, truncate } from '../../utils/formatters';
import { parsePageParam, useDebouncedUrlText, useListUrlParams } from '../../utils/listUrlState';
import { registerViewCache } from '../../utils/viewCaches';
import { Alert, Button, Loading, Pagination, SearchInput } from '../common';

const PAGE_SIZE = 20;

type SortDir = 'asc' | 'desc';

// Search, sort and page live in the URL (#/flows?q=…&sort=desc&page=2), so
// Back from a flow, a reload or a shared link shows the same view.
const LIST_DEFAULTS = { q: '', sort: 'asc', page: '1' };

// The collection from the last visit. Coming back from a flow shows it at
// once; it is fetched again (in the background, the list stays on screen)
// only when older than CACHE_FRESH_MS. Dropped on logout and connection switch.
const CACHE_FRESH_MS = 60_000;
let cachedDecisions: { items: DecisionFlow[]; fetchedAt: number } | null = null;

registerViewCache('flowList', () => {
  cachedDecisions = null;
});

export default function FlowListPage() {
  const navigate = useNavigate();
  const [allDecisions, setAllDecisions] = useState<DecisionFlow[]>(() => cachedDecisions?.items ?? []);
  const [params, updateParams] = useListUrlParams('flows', LIST_DEFAULTS);
  const sortDir: SortDir = params.sort === 'desc' ? 'desc' : 'asc';
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
  // Bumped by the alert's Retry button to re-run the load below.
  const [reloadToken, setReloadToken] = useState(0);

  // The whole collection is fetched once (server order: name ascending);
  // search and sort are applied to that in-memory list below.
  useEffect(() => {
    const cached = cachedDecisions;
    if (reloadToken === 0 && cached && Date.now() - cached.fetchedAt < CACHE_FRESH_MS) return;
    let active = true;
    // With a list already on screen the refetch is silent.
    if (!cached || reloadToken > 0) setLoading(true);
    setError('');
    listAllDecisions()
      .then((items) => {
        cachedDecisions = { items, fetchedAt: Date.now() };
        if (active) setAllDecisions(items);
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadToken]);

  // Client-side case-insensitive filter on name and description
  const filtered = useMemo(() => {
    if (!search.trim()) return allDecisions;
    const term = search.trim().toLowerCase();
    return allDecisions.filter((d) =>
      (d.name ?? '').toLowerCase().includes(term) ||
      (d.description ?? '').toLowerCase().includes(term),
    );
  }, [allDecisions, search]);

  // Copy before sorting: `filtered` is `allDecisions` itself when the search box is empty.
  const sorted = useMemo(() => {
    const copy = [...filtered].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    return sortDir === 'asc' ? copy : copy.reverse();
  }, [filtered, sortDir]);

  const total = sorted.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Clamped the way <Pagination> clamps its own page number, so a shorter
  // list after a reload cannot leave the table showing an empty page.
  const displayDecisions = useMemo(() => {
    const start = (Math.min(page, Math.max(1, totalPages)) - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page, totalPages]);

  const toggleSort = () => {
    updateParams({ sort: sortDir === 'asc' ? 'desc' : 'asc', page: '1' });
  };

  return (
    <div className="flow-list">
      <div className="flow-list__header">
        <h1 className="flow-list__title">Decision Flows</h1>
        <div className="flow-list__count">{total} decision{total !== 1 ? 's' : ''}</div>
      </div>

      <SearchInput
        aria-label="Search decisions"
        value={search}
        onChange={setSearch}
        placeholder="Search decisions (case insensitive)..."
        className="flow-list__search"
      />

      {error && (
        <div className="flow-list__alert">
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
        </div>
      )}

      <div className="flow-list__table-wrap">
        <table className="sas-table">
          <thead className="sas-table__head">
            <tr>
              {/* Name is the only sortable column, so its header button is
                  always the active one. */}
              <th className="sas-table__th" aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}>
                <button
                  type="button"
                  className="sas-table__sort-header sas-table__sort-header--active"
                  onClick={toggleSort}
                >
                  Name
                  <span className="sas-table__sort-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d={sortDir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
                    </svg>
                  </span>
                </button>
              </th>
              <th className="sas-table__th">Description</th>
              <th className="sas-table__th flow-list__col--modified">Modified</th>
              <th className="sas-table__th flow-list__col--modified-by">Modified by</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="sas-table__row">
                <td colSpan={4} className="sas-table__td flow-list__empty">
                  <Loading size="small" message="Loading decisions..." />
                </td>
              </tr>
            )}
            {!loading && displayDecisions.length === 0 && (
              <tr className="sas-table__row">
                <td colSpan={4} className="sas-table__td flow-list__empty">
                  {search ? 'No decisions match your search' : 'No decisions found'}
                </td>
              </tr>
            )}
            {!loading && displayDecisions.map((d) => (
              // The row is a mouse convenience; the name link is the keyboard
              // path, and --clickable carries the shared hover/focus tint.
              <tr
                key={d.id}
                className="sas-table__row sas-table__row--clickable"
                onClick={() => navigate(`/flows/${d.id}`)}
              >
                <td className="sas-table__td flow-list__col--name">
                  <Link to={`/flows/${d.id}`} className="flow-list__row-link" onClick={(e) => e.stopPropagation()}>
                    {d.name}
                  </Link>
                </td>
                <td className="sas-table__td flow-list__col--desc">{truncate(d.description ?? '', 60)}</td>
                <td className="sas-table__td flow-list__col--modified">{formatTimestamp(d.modifiedTimeStamp)}</td>
                <td className="sas-table__td flow-list__col--modified-by">{d.modifiedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={total}
          label="Decision list pages"
        />
      )}
    </div>
  );
}
