// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { StepOutput, StepParameter } from '../../types';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Badge, StatusBadge } from '../common/Badge';
import { Pagination } from '../common/Pagination';
import { DataGridModal } from './DataGridModal';
import { isDatagrid, datagridShape } from '../../utils/datagrid';

interface BatchResult {
  rowIndex: number;
  input: Record<string, unknown>;
  output: StepOutput | null;
  error: string | null;
  executionTime: number;
}

interface BatchStats {
  totalRuntime: number;
  avgRequestTime: number;
  successRate: number;
  fastestResponse: number;
  slowestResponse: number;
  medianResponse: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
}

interface BatchResultsProps {
  results: BatchResult[];
  parameters?: StepParameter[]; // Optional - used for type information if needed
  stats: BatchStats | null;
  onClear: () => void;
  onDownload: () => void;
  onUploadToCas?: () => void;
  onSaveAsScenarios?: (selectedIndices: number[]) => void;
}

// Rows rendered per page. `results` stays whole (CSV export, upload and
// "Save as Scenarios" read the full array by absolute index); only the
// rendered slice is paged so a large batch does not commit thousands of rows.
const PAGE_SIZES = [100, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

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

export const BatchResults: React.FC<BatchResultsProps> = ({
  results,
  parameters: _parameters,
  stats,
  onClear,
  onDownload,
  onUploadToCas,
  onSaveAsScenarios,
}) => {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [gridModal, setGridModal] = useState<{ title: string; value: unknown[] } | null>(null);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // 1-based, to match <Pagination>.
  const [page, setPage] = useState(1);
  const lastClickedRef = useRef<number | null>(null);

  const { successCount, errorCount, successIndices, successSet, outputParams } = useMemo(() => {
    const indices: number[] = [];
    let errors = 0;
    results.forEach((r, i) => {
      if (isSelectable(r)) indices.push(i);
      if (r.error) errors++;
    });
    return {
      successCount: indices.length,
      errorCount: errors,
      successIndices: indices,
      successSet: new Set(indices),
      // Output parameter names from the first successful result
      outputParams: results.find(r => r.output)?.output?.outputs?.map(o => o.name) ?? [],
    };
  }, [results]);

  // A fresh result set starts on its first page
  useEffect(() => {
    setPage(1);
  }, [results]);

  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleResults = results.slice(pageStart, pageStart + pageSize);

  const allSuccessSelected = successIndices.length > 0 && successIndices.every(i => selectedRows.has(i));

  const toggleSelectAll = () => {
    if (allSuccessSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(successIndices));
    }
    lastClickedRef.current = null;
  };

  const handleRowSelect = (index: number, shiftKey: boolean) => {
    const lastClicked = lastClickedRef.current;
    lastClickedRef.current = index;

    setSelectedRows(prev => {
      const next = new Set(prev);

      if (shiftKey && lastClicked !== null) {
        // Range select: add all successful rows between last click and this click
        const from = Math.min(lastClicked, index);
        const to = Math.max(lastClicked, index);
        for (let i = from; i <= to; i++) {
          if (successSet.has(i)) {
            next.add(i);
          }
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

  return (
    <Card className="batch-results">
      <CardHeader
        actions={
          <div className="batch-results__actions">
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
          </div>
        </div>
      </CardHeader>
      <CardBody>
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
            </div>
          </div>
        )}

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
                      title="Select all successful rows"
                      aria-label="Select all successful rows"
                    />
                  </th>
                )}
                <th className="sas-table__th">Row</th>
                <th className="sas-table__th">Status</th>
                {outputParams.map(name => (
                  <th className="sas-table__th" key={name}>{name}</th>
                ))}
                <th className="sas-table__th">Runtime</th>
                <th className="sas-table__th">Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((result, i) => {
                // Absolute index into `results`: selection, expansion and the
                // parent's "Save as Scenarios" all key on it, not the page slot.
                const index = pageStart + i;
                const selectable = isSelectable(result);
                const outputByName = new Map(result.output?.outputs?.map(o => [o.name, o.value]) ?? []);
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
                      {outputParams.map(name => (
                        <td key={name} className="sas-table__td batch-results__value">
                          {outputByName.has(name) ? formatValue(outputByName.get(name), name, result.rowIndex + 1) : '-'}
                        </td>
                      ))}
                      <td className="sas-table__td batch-results__value">{formatTime(result.executionTime)}</td>
                      <td className="sas-table__td">
                        <Button
                          variant="tertiary"
                          size="small"
                          onClick={() => toggleRow(index)}
                          aria-expanded={expandedRow === index}
                        >
                          {expandedRow === index ? 'Hide' : 'Show'}
                        </Button>
                      </td>
                    </tr>
                    {expandedRow === index && (
                      <tr className="batch-results__expanded-row">
                        <td colSpan={outputParams.length + 4 + (onSaveAsScenarios ? 1 : 0)}>
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
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {results.length > PAGE_SIZES[0] && (
          <Pagination
            label="Batch result rows"
            page={currentPage}
            totalPages={pageCount}
            onPageChange={setPage}
            pageSize={pageSize}
            totalItems={results.length}
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
