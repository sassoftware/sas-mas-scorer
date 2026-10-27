// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useMemo, useState, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, StatusBadge } from '../common/Badge';
import { Pagination } from '../common/Pagination';
import { DataGridModal } from './DataGridModal';
import { isDatagrid, datagridShape } from '../../utils/datagrid';
import { BatchResult, BatchStats, errorGroupKey } from './batchRunner';
import { formatCheckValue, hasExpectation } from '../../utils/expectedValues';
import { CheckBadge } from './CheckBadge';
import { ComparisonRule } from './ComparisonRule';

/** What the last "Retry failed rows" did. */
export interface RetryOutcome {
  /** Failed rows when the retry started */
  failed: number;
  /** Rows the retry reached (fewer when stopped) */
  attempted: number;
  /** Rows that succeeded on the retry */
  recovered: number;
}

interface BatchResultsProps {
  results: BatchResult[];
  parameters?: StepParameter[]; // Optional - used for type information if needed
  stats: BatchStats | null;
  onClear: () => void;
  onDownload: () => void;
  onUploadToCas?: () => void;
  onSaveAsScenarios?: (selectedIndices: number[]) => void;
  /** Re-runs only the failed rows; the button shows when there are any. */
  onRetryFailed?: () => void;
  /** Another batch is running, so a retry cannot start now. */
  retryDisabled?: boolean;
  retryOutcome?: RetryOutcome;
}

// Rows rendered per page. `results` stays whole (CSV export, upload and
// "Save as Scenarios" read the full array by absolute index); only the
// rendered slice is paged so a large batch does not commit thousands of rows.
const PAGE_SIZES = [100, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

// Error groups listed before "Show all"
const ERROR_GROUPS_SHOWN = 5;

type StatusFilter = 'all' | 'succeeded' | 'failed' | 'mismatched';
type SortDir = 'asc' | 'desc';
/** 'row', 'status', 'check', 'runtime', or an output name prefixed 'out:' */
type SortKey = string;

interface ErrorGroup {
  key: string;
  /** The message as shown: the message itself, or the masked key when the group's messages differ */
  label: string;
  count: number;
  /** Absolute index of the group's first row */
  first: number;
}

// Format milliseconds to human-readable string
const formatTime = (ms: number): string => {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
};

const isSelectable = (result: BatchResult): boolean => !!result.output && !result.error;

const statusOf = (result: BatchResult): string =>
  result.error ? 'failed' : (result.output?.executionState ?? 'pending');

// Sort value of one cell: a number, a string, or null (always sorted last)
const sortValueOf = (result: BatchResult, key: SortKey): number | string | null => {
  if (key === 'runtime') return result.executionTime;
  if (key === 'status') return statusOf(result);
  if (key === 'row') return result.rowIndex;
  // Differs first, then matches; rows not checked sort last
  if (key === 'check') {
    const status = result.check?.status;
    return status === 'fail' ? 0 : status === 'pass' ? 1 : null;
  }
  const name = key.slice(4);
  const value = result.output?.outputs?.find(o => o.name === name)?.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const COLLATE_MAX_DISTINCT = 10_000;

/**
 * The sorted order of `indices` by `key`. Values are read once (not inside
 * the comparator), and text is collated once per distinct value and replaced
 * by its rank, so the sort itself only compares numbers and a 100k-row sort
 * stays fast. Missing values sort last in both directions; numbers before
 * text; ties keep row order.
 */
const sortIndices = (
  results: BatchResult[],
  indices: number[],
  key: SortKey,
  dir: SortDir
): number[] => {
  const values = indices.map(i => sortValueOf(results[i], key));
  const distinctText = new Set<string>();
  for (const v of values) if (typeof v === 'string') distinctText.add(v);
  const textRank = new Map<string, number>();
  // Collation (natural numbers, case-blind) costs ~1 s for 100k distinct
  // values; past COLLATE_MAX_DISTINCT (ids, free text) plain order is used.
  const compareText = distinctText.size <= COLLATE_MAX_DISTINCT
    ? collator.compare
    : (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  Array.from(distinctText).sort(compareText).forEach((t, r) => textRank.set(t, r));

  // tier: 0 number, 1 text, 2 missing
  const entries = indices.map((i, k) => {
    const v = values[k];
    if (v === null) return { i, tier: 2, v: 0 };
    if (typeof v === 'number') return { i, tier: 0, v };
    return { i, tier: 1, v: textRank.get(v) ?? 0 };
  });
  const sign = dir === 'asc' ? 1 : -1;
  entries.sort((a, b) => {
    if (a.tier !== b.tier) {
      // Missing stays last whichever way the column is sorted
      if (a.tier === 2 || b.tier === 2) return a.tier - b.tier;
      return (a.tier - b.tier) * sign;
    }
    const c = a.v - b.v;
    return c !== 0 ? c * sign : a.i - b.i;
  });
  return entries.map(e => e.i);
};

interface SortHeaderProps {
  sortKey: SortKey;
  label: string;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}

// The shared .sas-table__sort-header: a real <button> filling the header
// cell, with aria-sort on the cell (the Coverage page's pattern).
const SortHeader: React.FC<SortHeaderProps> = ({ sortKey, label, current, dir, onSort }) => {
  const isActive = current === sortKey;
  return (
    <th className="sas-table__th" aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`sas-table__sort-header${isActive ? ' sas-table__sort-header--active' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <span className="sas-table__sort-icon">
          <svg
            viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2}
            opacity={isActive ? 1 : 0.3}
            aria-hidden="true"
          >
            <path d={isActive && dir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
          </svg>
        </span>
      </button>
    </th>
  );
};

export const BatchResults: React.FC<BatchResultsProps> = ({
  results,
  parameters: _parameters,
  stats,
  onClear,
  onDownload,
  onUploadToCas,
  onSaveAsScenarios,
  onRetryFailed,
  retryDisabled = false,
  retryOutcome,
}) => {
  const uid = useId();
  const rowButtonId = (index: number) => `${uid}-row-${index}`;

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [gridModal, setGridModal] = useState<{ title: string; value: unknown[] } | null>(null);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // 1-based, to match <Pagination>.
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Error group key the view is narrowed to, if any
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'row', dir: 'asc' });
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [retryNoteHidden, setRetryNoteHidden] = useState(false);
  // Row to bring into view (page + expand) once the view it lands in exists
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  // Row whose Show/Hide button takes focus after the next render that has it
  const focusRowRef = useRef<number | null>(null);
  const lastClickedRef = useRef<number | null>(null);

  // Everything derived from the whole result set, once per result set
  const {
    successCount, errorCount, successIndices, successSet, outputParams, errorKeys, errorGroups,
    hasExpected, mismatchIndices, matchCount, uncheckedCount,
  } = useMemo(() => {
    const indices: number[] = [];
    // Each row's check was computed once when it was scored; only counted here
    const mismatches: number[] = [];
    let matches = 0;
    let unchecked = 0;
    let anyExpected = false;
    const keys: (string | null)[] = new Array(results.length);
    const groups = new Map<string, ErrorGroup & { message: string; varies: boolean }>();
    let errors = 0;
    results.forEach((r, i) => {
      if (isSelectable(r)) indices.push(i);
      if (r.expected) anyExpected = true;
      if (r.check) {
        if (r.check.status === 'fail') mismatches.push(i);
        else if (r.check.status === 'pass') matches++;
        else unchecked++;
      }
      if (r.error) {
        errors++;
        const key = errorGroupKey(r.error);
        keys[i] = key;
        const group = groups.get(key);
        if (group) {
          group.count++;
          if (!group.varies && group.message !== r.error) group.varies = true;
        } else {
          groups.set(key, { key, label: '', message: r.error, varies: false, count: 1, first: i });
        }
      } else {
        keys[i] = null;
      }
    });
    const groupList: ErrorGroup[] = Array.from(groups.values())
      .map(g => ({ key: g.key, label: g.varies ? g.key : g.message, count: g.count, first: g.first }))
      .sort((a, b) => b.count - a.count || a.first - b.first);
    return {
      successCount: indices.length,
      errorCount: errors,
      successIndices: indices,
      successSet: new Set(indices),
      // Output parameter names from the first successful result
      outputParams: results.find(r => r.output)?.output?.outputs?.map(o => o.name) ?? [],
      errorKeys: keys,
      errorGroups: groupList,
      hasExpected: anyExpected,
      mismatchIndices: mismatches,
      matchCount: matches,
      uncheckedCount: unchecked,
    };
  }, [results]);

  // A fresh result set starts on its first page, unfiltered
  useEffect(() => {
    setPage(1);
    setStatusFilter('all');
    setGroupFilter(null);
  }, [results]);

  // Indices that pass the filter, in row order; null means "all of them" so
  // the unfiltered view allocates nothing.
  const filtered = useMemo<number[] | null>(() => {
    if (statusFilter === 'all' && groupFilter === null) return null;
    const out: number[] = [];
    if (groupFilter !== null) {
      errorKeys.forEach((key, i) => {
        if (key === groupFilter) out.push(i);
      });
      return out;
    }
    if (statusFilter === 'succeeded') return successIndices;
    if (statusFilter === 'mismatched') return mismatchIndices;
    errorKeys.forEach((key, i) => {
      if (key !== null) out.push(i);
    });
    return out;
  }, [statusFilter, groupFilter, errorKeys, successIndices, mismatchIndices]);

  // The filtered indices in the chosen order; null means row order over all
  // rows. Recomputed only when the filter or the sort changes, never per page.
  const view = useMemo<number[] | null>(() => {
    if (sort.key === 'row') {
      if (sort.dir === 'asc') return filtered;
      const base = filtered ?? Array.from({ length: results.length }, (_, i) => i);
      return base.slice().reverse();
    }
    const base = filtered ?? Array.from({ length: results.length }, (_, i) => i);
    return sortIndices(results, base, sort.key, sort.dir);
  }, [results, filtered, sort]);

  const viewLength = view ? view.length : results.length;
  const indexAt = (position: number): number => (view ? view[position] : position);
  const positionOf = (index: number): number => (view ? view.indexOf(index) : index);

  const pageCount = Math.max(1, Math.ceil(viewLength / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, viewLength);
  const visibleIndices: number[] = [];
  for (let p = pageStart; p < pageEnd; p++) visibleIndices.push(indexAt(p));

  // Bring a jumped-to row onto the page and open it, in whatever view the
  // jump left us in.
  useEffect(() => {
    if (jumpTarget === null) return;
    const position = view ? view.indexOf(jumpTarget) : jumpTarget;
    if (position >= 0) {
      setPage(Math.floor(position / pageSize) + 1);
      setExpandedRow(jumpTarget);
      focusRowRef.current = jumpTarget;
    }
    setJumpTarget(null);
  }, [jumpTarget, view, pageSize]);

  // Focus the jumped-to row once it is rendered
  useEffect(() => {
    const index = focusRowRef.current;
    if (index === null) return;
    const el = document.getElementById(rowButtonId(index));
    if (el) {
      focusRowRef.current = null;
      el.focus();
      el.scrollIntoView?.({ block: 'center' });
    }
  });

  // Successful rows in the current view: what "select all" acts on
  const viewSuccessIndices = useMemo(
    () => (filtered === null ? successIndices : filtered.filter(i => successSet.has(i))),
    [filtered, successIndices, successSet]
  );
  const allSuccessSelected =
    viewSuccessIndices.length > 0 && viewSuccessIndices.every(i => selectedRows.has(i));

  const toggleSelectAll = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSuccessSelected) viewSuccessIndices.forEach(i => next.delete(i));
      else viewSuccessIndices.forEach(i => next.add(i));
      return next;
    });
    lastClickedRef.current = null;
  };

  const handleRowSelect = (index: number, shiftKey: boolean) => {
    const lastClicked = lastClickedRef.current;
    lastClickedRef.current = index;

    // Range select runs over the rows as shown (filtered and sorted), not
    // over row numbers, so it selects what lies between the two clicks.
    const fromPos = shiftKey && lastClicked !== null ? positionOf(lastClicked) : -1;
    const toPos = fromPos >= 0 ? positionOf(index) : -1;

    setSelectedRows(prev => {
      const next = new Set(prev);

      if (fromPos >= 0 && toPos >= 0) {
        // Range select: add all successful rows between last click and this click
        const from = Math.min(fromPos, toPos);
        const to = Math.max(fromPos, toPos);
        for (let p = from; p <= to; p++) {
          const i = indexAt(p);
          if (successSet.has(i)) next.add(i);
        }
      } else {
        // Single toggle
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
      }

      return next;
    });
  };

  const toggleRow = (index: number) => {
    setExpandedRow(expandedRow === index ? null : index);
  };

  const changeStatusFilter = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setGroupFilter(null);
    setPage(1);
  };

  const toggleGroupFilter = (key: string) => {
    setGroupFilter(prev => (prev === key ? null : key));
    setStatusFilter('failed');
    setPage(1);
  };

  const handleSort = (key: SortKey) => {
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    setPage(1);
  };

  // Go to the first row of an error group. A view that hides it (Succeeded,
  // or another group) is widened to the failed rows first; the sort stays.
  const jumpToRow = (index: number) => {
    const shown = groupFilter !== null
      ? errorKeys[index] === groupFilter
      : statusFilter === 'all' || statusFilter === 'failed';
    if (!shown) {
      setGroupFilter(null);
      setStatusFilter('failed');
    }
    setJumpTarget(index);
  };

  const formatValue = (value: unknown, name: string, rowNumber: number): React.ReactNode => {
    if (value === null || value === undefined) return 'null';
    if (isDatagrid(value)) {
      // Full datagrids get messy inline — show the shape as a link into a modal viewer
      const shape = datagridShape(value);
      return (
        <button
          type="button"
          className="datagrid__link"
          onClick={() => setGridModal({ title: `${name} — row ${rowNumber}`, value })}
          title="View DataGrid"
        >
          DataGrid({shape.rows} × {shape.cols})
        </button>
      );
    }
    if (Array.isArray(value)) {
      return value
        .map(v => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)))
        .join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const activeGroup = groupFilter !== null ? errorGroups.find(g => g.key === groupFilter) : undefined;
  const shownGroups = showAllGroups ? errorGroups : errorGroups.slice(0, ERROR_GROUPS_SHOWN);
  const columnCount = outputParams.length + 4 + (onSaveAsScenarios ? 1 : 0) + (hasExpected ? 1 : 0);

  const filterDescription = activeGroup
    ? `Showing ${viewLength.toLocaleString()} of ${results.length.toLocaleString()} rows: failed with “${activeGroup.label}”`
    : statusFilter === 'failed'
    ? `Showing ${viewLength.toLocaleString()} failed of ${results.length.toLocaleString()} rows`
    : statusFilter === 'succeeded'
    ? `Showing ${viewLength.toLocaleString()} succeeded of ${results.length.toLocaleString()} rows`
    : statusFilter === 'mismatched'
    ? `Showing ${viewLength.toLocaleString()} of ${results.length.toLocaleString()} rows: outputs differ from expected`
    : `Showing all ${results.length.toLocaleString()} rows`;

  const statusChips: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: results.length },
    { value: 'succeeded', label: 'Succeeded', count: successCount },
    { value: 'failed', label: 'Failed', count: errorCount },
    ...(hasExpected
      ? [{ value: 'mismatched' as StatusFilter, label: 'Mismatched', count: mismatchIndices.length }]
      : []),
  ];

  return (
    <Card className="batch-results">
      <CardHeader
        actions={
          <div className="batch-results__actions">
            {onRetryFailed && errorCount > 0 && (
              <Button
                variant="secondary"
                size="small"
                onClick={onRetryFailed}
                disabled={retryDisabled}
                title="Score only the failed rows again, with the inputs they were sent with; successful rows are kept"
              >
                Retry failed rows ({errorCount.toLocaleString()})
              </Button>
            )}
            {onSaveAsScenarios && (
              <Button
                variant="primary"
                size="small"
                onClick={() => onSaveAsScenarios(Array.from(selectedRows).sort((a, b) => a - b))}
                disabled={selectedRows.size === 0}
              >
                Save as Scenarios ({selectedRows.size})
              </Button>
            )}
            {onUploadToCas && (
              <Button variant="secondary" size="small" onClick={onUploadToCas}>
                Upload to CAS
              </Button>
            )}
            <Button variant="secondary" size="small" onClick={onDownload}>
              Download CSV
            </Button>
            <Button variant="tertiary" size="small" onClick={onClear}>
              Clear Results
            </Button>
          </div>
        }
      >
        <div className="batch-results__header">
          <h3>Batch Results</h3>
          <div className="batch-results__summary">
            <Badge variant="success">{successCount} succeeded</Badge>
            {errorCount > 0 && <Badge variant="error">{errorCount} failed</Badge>}
            {hasExpected && (
              <CheckBadge
                status={mismatchIndices.length > 0 ? 'fail' : matchCount > 0 ? 'pass' : 'none'}
                size="medium"
                label={`${mismatchIndices.length.toLocaleString()} differ from expected`}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        {retryOutcome && !retryNoteHidden && (
          <Alert
            variant={retryOutcome.recovered === retryOutcome.failed ? 'success' : 'info'}
            dismissible
            onClose={() => setRetryNoteHidden(true)}
          >
            {retryOutcome.attempted < retryOutcome.failed
              ? `Retry stopped after ${retryOutcome.attempted.toLocaleString()} of ${retryOutcome.failed.toLocaleString()} failed rows: `
              : `Retried ${retryOutcome.failed.toLocaleString()} failed row${retryOutcome.failed === 1 ? '' : 's'}: `}
            {retryOutcome.recovered.toLocaleString()} now succeeded
            {errorCount > 0 ? `, ${errorCount.toLocaleString()} still failed.` : '.'}
          </Alert>
        )}

        {/* Stats Overview */}
        {stats && (
          <div className="batch-results__overview">
            <div className="batch-results__overview-grid">
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.totalRuntime)}</span>
                <span className="batch-results__stat-label">Total Runtime</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.avgRequestTime)}</span>
                <span className="batch-results__stat-label">Avg Request Time</span>
              </div>
              <div className="batch-results__stat-card">
                <span className={`batch-results__stat-value ${stats.successRate === 100 ? 'batch-results__stat-value--success' : stats.successRate < 50 ? 'batch-results__stat-value--error' : ''}`}>
                  {stats.successRate.toFixed(1)}%
                </span>
                <span className="batch-results__stat-label">Success Rate</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--success">{formatTime(stats.fastestResponse)}</span>
                <span className="batch-results__stat-label">Fastest Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--warning">{formatTime(stats.slowestResponse)}</span>
                <span className="batch-results__stat-label">Slowest Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{formatTime(stats.medianResponse)}</span>
                <span className="batch-results__stat-label">Median Response</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value">{stats.totalRequests}</span>
                <span className="batch-results__stat-label">Total Requests</span>
              </div>
              <div className="batch-results__stat-card">
                <span className="batch-results__stat-value batch-results__stat-value--success">{stats.successCount}</span>
                <span className="batch-results__stat-label">Succeeded</span>
              </div>
              <div className="batch-results__stat-card">
                <span className={`batch-results__stat-value ${stats.errorCount > 0 ? 'batch-results__stat-value--error' : ''}`}>
                  {stats.errorCount}
                </span>
                <span className="batch-results__stat-label">Failed</span>
              </div>
              {hasExpected && (
                <div className="batch-results__stat-card">
                  <span className={`batch-results__stat-value ${mismatchIndices.length > 0 ? 'batch-results__stat-value--error' : 'batch-results__stat-value--success'}`}>
                    {mismatchIndices.length.toLocaleString()}
                  </span>
                  <span className="batch-results__stat-label">Mismatches</span>
                </div>
              )}
              {hasExpected && (
                <div className="batch-results__stat-card">
                  <span className="batch-results__stat-value">{matchCount.toLocaleString()}</span>
                  <span className="batch-results__stat-label">Match Expected</span>
                </div>
              )}
              {hasExpected && uncheckedCount > 0 && (
                <div className="batch-results__stat-card">
                  <span className="batch-results__stat-value">{uncheckedCount.toLocaleString()}</span>
                  <span className="batch-results__stat-label">Not Checked</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Failures grouped by message, most frequent first */}
        {errorGroups.length > 0 && (
          <section className="batch-results__errors" aria-labelledby={`${uid}-errors-title`}>
            <h4 className="batch-results__errors-title" id={`${uid}-errors-title`}>
              Errors by message ({errorGroups.length.toLocaleString()} {errorGroups.length === 1 ? 'kind' : 'kinds'})
            </h4>
            <ul className="batch-results__error-list">
              {shownGroups.map(group => {
                const firstRow = results[group.first].rowIndex + 1;
                return (
                  <li key={group.key} className="batch-results__error-group">
                    <span className="batch-results__error-count">{group.count.toLocaleString()} ×</span>
                    <span className="batch-results__error-message">{group.label}</span>
                    <span className="batch-results__error-actions">
                      <Button
                        variant="tertiary"
                        size="small"
                        aria-pressed={groupFilter === group.key}
                        onClick={() => toggleGroupFilter(group.key)}
                      >
                        {groupFilter === group.key ? 'Showing these rows' : 'Show these rows'}
                      </Button>
                      <Button
                        variant="tertiary"
                        size="small"
                        onClick={() => jumpToRow(group.first)}
                        title="Open the first row with this error"
                      >
                        Go to row {firstRow.toLocaleString()}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {errorGroups.length > ERROR_GROUPS_SHOWN && (
              <Button
                variant="tertiary"
                size="small"
                aria-expanded={showAllGroups}
                onClick={() => setShowAllGroups(v => !v)}
              >
                {showAllGroups ? 'Show fewer' : `Show all ${errorGroups.length.toLocaleString()} kinds`}
              </Button>
            )}
          </section>
        )}

        {hasExpected && (
          <div className="batch-results__expected-note">
            <p>
              Rows are checked against the mapped expected-output columns: a row
              &ldquo;Differs&rdquo; when at least one compared output is not the same as its expected
              value, and is &ldquo;Not checked&rdquo; when all its expected cells are blank. Failed
              rows are not compared.
            </p>
            <ComparisonRule />
          </div>
        )}

        {/* Filter by status */}
        <div className="batch-results__toolbar">
          <div className="batch-results__chips" role="group" aria-label="Show rows by status">
            {statusChips.map(chip => {
              const active = statusFilter === chip.value && (chip.value !== 'failed' || groupFilter === null);
              return (
                <button
                  key={chip.value}
                  type="button"
                  className={`batch-results__chip${active ? ' batch-results__chip--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => changeStatusFilter(chip.value)}
                >
                  {chip.label} ({chip.count.toLocaleString()})
                </button>
              );
            })}
          </div>
          <span className="batch-results__view-count" role="status" aria-live="polite">
            {filterDescription}
          </span>
          {(statusFilter !== 'all' || groupFilter !== null) && (
            <Button variant="tertiary" size="small" onClick={() => changeStatusFilter('all')}>
              Show all rows
            </Button>
          )}
        </div>

        <div className="sas-table__wrapper">
          <table className="sas-table sas-table--compact">
            <thead className="sas-table__head">
              <tr>
                {onSaveAsScenarios && (
                  <th className="sas-table__th batch-results__checkbox-cell">
                    <input
                      type="checkbox"
                      checked={allSuccessSelected}
                      onChange={toggleSelectAll}
                      disabled={viewSuccessIndices.length === 0}
                      title={filtered === null ? 'Select all successful rows' : 'Select all successful rows shown'}
                      aria-label={filtered === null ? 'Select all successful rows' : 'Select all successful rows shown'}
                    />
                  </th>
                )}
                <SortHeader sortKey="row" label="Row" current={sort.key} dir={sort.dir} onSort={handleSort} />
                <SortHeader sortKey="status" label="Status" current={sort.key} dir={sort.dir} onSort={handleSort} />
                {hasExpected && (
                  <SortHeader sortKey="check" label="Expected" current={sort.key} dir={sort.dir} onSort={handleSort} />
                )}
                {outputParams.map(name => (
                  <SortHeader
                    key={name}
                    sortKey={`out:${name}`}
                    label={name}
                    current={sort.key}
                    dir={sort.dir}
                    onSort={handleSort}
                  />
                ))}
                <SortHeader sortKey="runtime" label="Runtime" current={sort.key} dir={sort.dir} onSort={handleSort} />
                <th className="sas-table__th">Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleIndices.length === 0 && (
                <tr className="sas-table__row">
                  <td className="sas-table__td batch-results__empty" colSpan={columnCount}>
                    No rows match this filter.
                  </td>
                </tr>
              )}
              {visibleIndices.map(index => {
                // Absolute index into `results`: selection, expansion and the
                // parent's "Save as Scenarios" all key on it, not the page slot.
                const result = results[index];
                const selectable = isSelectable(result);
                const outputByName = new Map(result.output?.outputs?.map(o => [o.name, o.value]) ?? []);
                const differs = result.check?.failed;
                return (
                  <React.Fragment key={index}>
                    <tr className={`sas-table__row${result.error ? ' batch-results__row--error' : ''}`}>
                      {onSaveAsScenarios && (
                        <td className="sas-table__td batch-results__checkbox-cell">
                          {selectable && (
                            <input
                              type="checkbox"
                              checked={selectedRows.has(index)}
                              aria-label={`Select row ${result.rowIndex + 1}`}
                              // onClick carries the Shift state for range select;
                              // onChange keeps React's controlled-input contract.
                              onClick={(e) => handleRowSelect(index, e.shiftKey)}
                              onChange={() => {}}
                            />
                          )}
                        </td>
                      )}
                      <td className="sas-table__td">{result.rowIndex + 1}</td>
                      <td className="sas-table__td">
                        {result.error ? (
                          <StatusBadge status="failed" />
                        ) : result.output ? (
                          <StatusBadge status={result.output.executionState} />
                        ) : (
                          <Badge variant="default">Pending</Badge>
                        )}
                      </td>
                      {hasExpected && (
                        <td className="sas-table__td">
                          {result.check ? (
                            <CheckBadge
                              status={result.check.status}
                              label={result.check.status === 'fail'
                                ? `Differs (${result.check.failed.length})`
                                : undefined}
                            />
                          ) : '-'}
                        </td>
                      )}
                      {outputParams.map(name => {
                        const cellDiffers = !!differs && differs.includes(name);
                        return (
                          <td
                            key={name}
                            className={`sas-table__td batch-results__value${cellDiffers ? ' batch-results__value--differs' : ''}`}
                          >
                            {outputByName.has(name) ? formatValue(outputByName.get(name), name, result.rowIndex + 1) : '-'}
                            {cellDiffers && (
                              <span className="batch-results__expected-value">
                                expected {formatCheckValue(result.expected?.[name]) || '(missing)'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="sas-table__td batch-results__value">{formatTime(result.executionTime)}</td>
                      <td className="sas-table__td">
                        <Button
                          id={rowButtonId(index)}
                          variant="tertiary"
                          size="small"
                          onClick={() => toggleRow(index)}
                          aria-expanded={expandedRow === index}
                          aria-label={`${expandedRow === index ? 'Hide' : 'Show'} details of row ${result.rowIndex + 1}`}
                        >
                          {expandedRow === index ? 'Hide' : 'Show'}
                        </Button>
                      </td>
                    </tr>
                    {expandedRow === index && (
                      <tr className="batch-results__expanded-row">
                        <td colSpan={columnCount}>
                          <div className="batch-results__details">
                            <div className="batch-results__detail-section">
                              <h5>Input Values</h5>
                              <pre>{JSON.stringify(result.input, null, 2)}</pre>
                            </div>
                            {result.error ? (
                              <div className="batch-results__detail-section batch-results__detail-section--error">
                                <h5>Error</h5>
                                <pre>{result.error}</pre>
                              </div>
                            ) : result.output ? (
                              <div className="batch-results__detail-section">
                                <h5>Full Output</h5>
                                <pre>{JSON.stringify(result.output, null, 2)}</pre>
                              </div>
                            ) : null}
                          </div>
                          {result.expected && result.check && (
                            <table className="sas-table sas-table--compact batch-results__check-table">
                              <caption className="batch-results__check-caption">Expected and actual outputs</caption>
                              <thead className="sas-table__head">
                                <tr>
                                  <th className="sas-table__th" scope="col">Output</th>
                                  <th className="sas-table__th" scope="col">Expected</th>
                                  <th className="sas-table__th" scope="col">Actual</th>
                                  <th className="sas-table__th" scope="col">Check</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(result.expected).map(([name, exp]) => {
                                  const checked = hasExpectation(exp);
                                  const failed = result.check?.failed.includes(name) ?? false;
                                  return (
                                    <tr className="sas-table__row" key={name}>
                                      <td className="sas-table__td">{name}</td>
                                      <td className="sas-table__td batch-results__value">{checked ? formatCheckValue(exp) : '(blank)'}</td>
                                      <td className="sas-table__td batch-results__value">{formatCheckValue(outputByName.get(name)) || '(missing)'}</td>
                                      <td className="sas-table__td">
                                        <CheckBadge status={!checked ? 'none' : failed ? 'fail' : 'pass'} />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                          {result.retries ? (
                            <p className="batch-results__retry-note">
                              Sent {result.retries + 1} times: the first {result.retries === 1 ? 'attempt' : `${result.retries} attempts`} failed
                              with a temporary error and {result.retries === 1 ? 'was' : 'were'} retried automatically.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {viewLength > PAGE_SIZES[0] && (
          <Pagination
            label="Batch result rows"
            page={currentPage}
            totalPages={pageCount}
            onPageChange={setPage}
            pageSize={pageSize}
            totalItems={viewLength}
            pageSizeOptions={PAGE_SIZES}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </CardBody>
      {gridModal && (
        <DataGridModal
          title={gridModal.title}
          value={gridModal.value}
          onClose={() => setGridModal(null)}
        />
      )}
    </Card>
  );
};

export default BatchResults;
