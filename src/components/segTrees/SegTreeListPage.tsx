// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listAllSegmentationTrees, type SegmentationTreeSummary } from '../../api/segmentationTrees';
import { formatTimestamp, truncate } from '../../utils/formatters';
import { Alert, Button, Loading, Pagination, SearchInput } from '../common';

const PAGE_SIZE = 20;

type SortDir = 'asc' | 'desc';

export default function SegTreeListPage() {
  const navigate = useNavigate();
  const [allTrees, setAllTrees] = useState<SegmentationTreeSummary[]>([]);
  const [search, setSearch] = useState('');
  // 1-based, the page number <Pagination> speaks.
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // Bumped by the alert's Retry button to re-run the load below.
  const [reloadToken, setReloadToken] = useState(0);

  // The whole collection is fetched once; search and sort run in memory.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listAllSegmentationTrees()
      .then((items) => { if (active) setAllTrees(items); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadToken]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allTrees;
    const term = search.trim().toLowerCase();
    return allTrees.filter((t) =>
      (t.name ?? '').toLowerCase().includes(term) ||
      (t.description ?? '').toLowerCase().includes(term),
    );
  }, [allTrees, search]);

  // Copy before sorting: `filtered` is `allTrees` itself when the search box is empty.
  const sorted = useMemo(() => {
    const copy = [...filtered].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    return sortDir === 'asc' ? copy : copy.reverse();
  }, [filtered, sortDir]);

  const total = sorted.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const displayTrees = useMemo(() => {
    const start = (Math.min(page, Math.max(1, totalPages)) - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page, totalPages]);

  const toggleSort = () => {
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    setPage(1);
  };

  return (
    <div className="flow-list">
      <div className="flow-list__header">
        <h1 className="flow-list__title">Segmentation Trees</h1>
        <div className="flow-list__count">{total} tree{total !== 1 ? 's' : ''}</div>
      </div>

      <SearchInput
        aria-label="Search segmentation trees"
        value={search}
        onChange={setSearch}
        placeholder="Search segmentation trees (case insensitive)..."
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
                  <Loading size="small" message="Loading segmentation trees..." />
                </td>
              </tr>
            )}
            {!loading && displayTrees.length === 0 && (
              <tr className="sas-table__row">
                <td colSpan={4} className="sas-table__td flow-list__empty">
                  {search ? 'No segmentation trees match your search' : 'No segmentation trees found'}
                </td>
              </tr>
            )}
            {!loading && displayTrees.map((t) => (
              // The row is a mouse convenience; the name link is the keyboard path.
              <tr
                key={t.id}
                className="sas-table__row sas-table__row--clickable"
                onClick={() => navigate(`/segmentation-trees/${t.id}`)}
              >
                <td className="sas-table__td flow-list__col--name">
                  <Link to={`/segmentation-trees/${t.id}`} className="flow-list__row-link" onClick={(e) => e.stopPropagation()}>
                    {t.name}
                  </Link>
                </td>
                <td className="sas-table__td flow-list__col--desc">{truncate(t.description ?? '', 60)}</td>
                <td className="sas-table__td flow-list__col--modified">{formatTimestamp(t.modifiedTimeStamp)}</td>
                <td className="sas-table__td flow-list__col--modified-by">{t.modifiedBy}</td>
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
          label="Segmentation tree list pages"
        />
      )}
    </div>
  );
}
