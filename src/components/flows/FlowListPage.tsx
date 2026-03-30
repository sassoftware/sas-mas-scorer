// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDecisions } from '../../api/decisions';
import type { DecisionFlow } from '../../types/sid';
import { formatTimestamp, truncate } from '../../utils/formatters';

const PAGE_SIZE = 20;
const FETCH_LIMIT = 10000;

type SortDir = 'asc' | 'desc';

export default function FlowListPage() {
  const navigate = useNavigate();
  const [allDecisions, setAllDecisions] = useState<DecisionFlow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const fetchDecisions = useCallback(async (searchTerm: string, sort: SortDir) => {
    setLoading(true);
    setError('');
    try {
      const sortBy = `name:${sort === 'asc' ? 'ascending' : 'descending'}`;
      const result = await listDecisions(searchTerm || undefined, 0, FETCH_LIMIT, sortBy);
      setAllDecisions(result.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search + sort changes
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(0);
      fetchDecisions(search, sortDir);
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [search, sortDir, fetchDecisions]);

  const total = allDecisions.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = page + 1;

  const displayDecisions = useMemo(() => {
    const start = page * PAGE_SIZE;
    return allDecisions.slice(start, start + PAGE_SIZE);
  }, [allDecisions, page]);

  const toggleSort = () => {
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div className="flow-list">
      <div className="flow-list__header">
        <h1 className="flow-list__title">Decision Flows</h1>
        <div className="flow-list__count">{total} decision{total !== 1 ? 's' : ''}</div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search decisions (case insensitive)..."
        className="flow-list__search"
      />

      {error && <div className="flow-list__error">{error}</div>}

      <div className="flow-list__table-wrap">
        <table className="flow-list__table">
          <thead>
            <tr>
              <th
                onClick={toggleSort}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Name {sortDir === 'asc' ? '▲' : '▼'}
              </th>
              <th>Description</th>
              <th style={{ width: '144px' }}>Modified</th>
              <th style={{ width: '112px' }}>Modified by</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="flow-list__empty">Loading...</td>
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
              <tr key={d.id} onClick={() => navigate(`/flows/${d.id}`)}>
                <td style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--sas-gray-800)' }}>
                  {d.name}
                </td>
                <td style={{ color: 'var(--sas-gray-500)' }}>{truncate(d.description ?? '', 60)}</td>
                <td style={{ color: 'var(--sas-gray-400)', fontSize: 'var(--font-size-xs)' }}>
                  {formatTimestamp(d.modifiedTimeStamp)}
                </td>
                <td style={{ color: 'var(--sas-gray-400)' }}>{d.modifiedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flow-pagination">
          <button
            className="flow-pagination__btn"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
          >
            Previous
          </button>
          <span className="flow-pagination__info">
            Page {currentPage} of {totalPages}
          </span>
          <button
            className="flow-pagination__btn"
            onClick={() => setPage(page + 1)}
            disabled={currentPage >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
