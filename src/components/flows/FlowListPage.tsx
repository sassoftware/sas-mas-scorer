// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listAllDecisions } from '../../api/decisions';
import type { DecisionFlow } from '../../types/sid';
import { formatTimestamp, truncate } from '../../utils/formatters';
import { Alert, Button, Loading, SearchInput } from '../common';

const PAGE_SIZE = 20;

type SortDir = 'asc' | 'desc';

export default function FlowListPage() {
  const navigate = useNavigate();
  const [allDecisions, setAllDecisions] = useState<DecisionFlow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // The whole collection is fetched once (server order: name ascending);
  // search and sort are applied to that in-memory list below.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listAllDecisions()
      .then((items) => { if (active) setAllDecisions(items); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search]);

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
  const currentPage = page + 1;

  const displayDecisions = useMemo(() => {
    const start = page * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page]);

  const toggleSort = () => {
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    setPage(0);
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
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="flow-list__table-wrap">
        <table className="flow-list__table">
          <thead>
            <tr>
              <th aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}>
                <button type="button" className="flow-list__sort-btn" onClick={toggleSort}>
                  Name
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d={sortDir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
                  </svg>
                </button>
              </th>
              <th>Description</th>
              <th className="flow-list__col--modified">Modified</th>
              <th className="flow-list__col--modified-by">Modified by</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="flow-list__empty">
                  <Loading size="small" message="Loading decisions..." />
                </td>
              </tr>
            )}
            {!loading && displayDecisions.length === 0 && (
              <tr>
                <td colSpan={4} className="flow-list__empty">
                  {search ? 'No decisions match your search' : 'No decisions found'}
                </td>
              </tr>
            )}
            {!loading && displayDecisions.map((d) => (
              // The row is a mouse convenience; the name link is the keyboard path.
              <tr key={d.id} className="flow-list__row" onClick={() => navigate(`/flows/${d.id}`)}>
                <td className="flow-list__col--name">
                  <Link to={`/flows/${d.id}`} className="flow-list__row-link" onClick={(e) => e.stopPropagation()}>
                    {d.name}
                  </Link>
                </td>
                <td className="flow-list__col--desc">{truncate(d.description ?? '', 60)}</td>
                <td className="flow-list__col--modified">{formatTimestamp(d.modifiedTimeStamp)}</td>
                <td className="flow-list__col--modified-by">{d.modifiedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flow-pagination">
          <Button
            variant="secondary"
            size="small"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="flow-pagination__info">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setPage(page + 1)}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
