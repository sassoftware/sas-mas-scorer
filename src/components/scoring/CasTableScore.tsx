// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, TypeBadge } from '../common/Badge';
import {
  getCasTables,
  getTableColumns,
  getTableRows,
  getAllTableRows,
  CasTableInfo,
  CasColumnInfo,
} from '../../api/cas';
import { useCasCatalog } from '../../hooks/useCasCatalog';

export interface CasTableTestInfo {
  serverName: string;
  libraryName: string;
  tableName: string;
  columnMappings: Record<string, string | null>;
}

interface CasTableScoreProps {
  parameters: StepParameter[];
  onExecuteBatch: (rows: Record<string, unknown>[], concurrency: number) => void;
  executing: boolean;
  onSaveAsTest?: (info: CasTableTestInfo) => void;
}

interface ColumnMapping {
  [paramName: string]: string | null;
}

interface FetchProgress {
  loaded: number;
  total: number | null;
}

const DEFAULT_ROW_LIMIT = 1000;

// Above this many rows the run is still allowed, but the footer warns that it
// sends one MAS request per row and keeps every row in memory until it ends.
const LARGE_RUN_WARNING = 50_000;

// Page size for a row-limited fetch. The rowSets service may cap a page below
// what was asked, so the loop continues from the rows actually received and
// stops on a page shorter than the limit the service echoed back.
const LIMITED_FETCH_PAGE = 5000;
const LIMITED_FETCH_MAX_PAGES = 1000;

// Convert CAS cell value to appropriate type based on parameter type
const convertValue = (value: unknown, type: string): unknown => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const str = String(value);

  switch (type) {
    case 'decimal':
      return parseFloat(str) || 0;
    case 'integer':
    case 'bigint':
      return parseInt(str, 10) || 0;
    case 'string':
      return str;
    case 'decimalArray':
      return str.split(';').map(v => parseFloat(v.trim()) || 0);
    case 'integerArray':
    case 'bigintArray':
      return str.split(';').map(v => parseInt(v.trim(), 10) || 0);
    case 'stringArray':
      return str.split(';').map(v => v.trim());
    default:
      return str;
  }
};

// Auto-match CAS column names to step parameters
const autoMapColumns = (
  columnNames: string[],
  parameters: StepParameter[]
): ColumnMapping => {
  const mapping: ColumnMapping = {};
  const normalizedColumns = columnNames.map(h => h.toLowerCase().replace(/[_\s-]/g, ''));

  parameters.forEach(param => {
    const normalizedParam = param.name.toLowerCase().replace(/[_\s-]/g, '');

    let matchIndex = normalizedColumns.findIndex(h => h === normalizedParam);

    if (matchIndex === -1) {
      matchIndex = normalizedColumns.findIndex(h =>
        h.includes(normalizedParam) || normalizedParam.includes(h)
      );
    }

    mapping[param.name] = matchIndex !== -1 ? columnNames[matchIndex] : null;
  });

  return mapping;
};

// Extract a cell value from a row, handling both array and object row formats
const getCellValue = (row: unknown, colName: string, colIndex: number): unknown => {
  if (Array.isArray(row)) {
    return row[colIndex];
  }
  if (row && typeof row === 'object') {
    return (row as Record<string, unknown>)[colName];
  }
  return undefined;
};

/**
 * Fetch the first `limit` rows of a table, page by page. Unlike a single
 * request sized to `limit`, a capped page continues from where it stopped.
 */
const fetchRowsUpTo = async (
  serverName: string,
  caslibName: string,
  tableName: string,
  limit: number,
  onProgress: (progress: FetchProgress) => void
): Promise<unknown[][]> => {
  const rows: unknown[][] = [];
  let start = 0;
  for (let page = 0; page < LIMITED_FETCH_MAX_PAGES && rows.length < limit; page++) {
    const want = Math.min(LIMITED_FETCH_PAGE, limit - rows.length);
    const result = await getTableRows(serverName, caslibName, tableName, start, want);
    if (result.rows.length === 0) break;
    for (const row of result.rows) rows.push(row);
    start += result.rows.length;
    onProgress({ loaded: Math.min(rows.length, limit), total: limit });

    // Compare against the page size the service echoed, not the one requested
    const echoedLimit = result.limit > 0 ? result.limit : want;
    if (result.rows.length < echoedLimit) break;
    if (result.count > 0 && start >= result.count) break;
  }
  return rows.length > limit ? rows.slice(0, limit) : rows;
};

export const CasTableScore: React.FC<CasTableScoreProps> = ({
  parameters,
  onExecuteBatch,
  executing,
  onSaveAsTest,
}) => {
  // Browse state. The server/caslib catalogue comes from the shared session
  // cache; tables are still fetched per caslib (cas.ts is unchanged).
  const [tables, setTables] = useState<CasTableInfo[]>([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const {
    servers,
    caslibs,
    loadingServers,
    loadingCaslibs,
    error: casError,
  } = useCasCatalog(selectedServer);

  // Loading states
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  // Table data state
  const [columns, setColumns] = useState<CasColumnInfo[]>([]);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [totalRowCount, setTotalRowCount] = useState<number>(0);

  // Mapping & execution config
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [scoreFullTable, setScoreFullTable] = useState(false);
  const [rowLimit, setRowLimit] = useState<number>(DEFAULT_ROW_LIMIT);
  const [concurrency, setConcurrency] = useState<number>(2);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Generation of the current table selection. handleSelectTable captures it
  // at entry and the caslib/table cascades bump it, so a slow column or
  // preview response for an earlier table (or an earlier caslib) never lands
  // under the selection that replaced it.
  const selectionRef = useRef(0);
  const invalidateSelection = () => ++selectionRef.current;

  // Auto-select the first server offered. Nothing downstream is selected yet,
  // so this path needs none of the resets handleServerChange does.
  useEffect(() => {
    if (selectedServer || servers.length === 0) return;
    setSelectedServer(servers[0].name);
  }, [servers, selectedServer]);

  // Prefer the "Public" caslib of whatever server is selected, else the first.
  useEffect(() => {
    if (caslibs.length === 0) {
      setSelectedCaslib('');
      return;
    }
    const publicLib = caslibs.find(c => c.name.toLowerCase() === 'public');
    setSelectedCaslib(publicLib?.name ?? caslibs[0].name);
  }, [caslibs]);

  // Picking a different server drops everything chosen underneath it. This
  // used to live in the caslib-loading effect; the catalogue now loads in the
  // hook, so the resets belong to the event that causes them.
  const handleServerChange = useCallback((serverName: string) => {
    invalidateSelection();
    setSelectedServer(serverName);
    setSelectedCaslib('');
    setSelectedTable('');
    setTables([]);
    setColumns([]);
    setPreviewRows([]);
    setLoadingRows(false);
    setError(null);
  }, []);

  // Load tables when caslib changes (getCasTables walks every page)
  useEffect(() => {
    if (!selectedServer || !selectedCaslib) {
      setTables([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      invalidateSelection();
      setLoadingTables(true);
      setSelectedTable('');
      setColumns([]);
      setPreviewRows([]);
      setLoadingRows(false);
      setError(null);
      try {
        const result = await getCasTables(selectedServer, selectedCaslib, 0, 500);
        if (cancelled) return;
        setTables(result.items.filter(t => (t.rowCount ?? 0) > 0));
      } catch (err: unknown) {
        if (cancelled) return;
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load tables');
      } finally {
        if (!cancelled) setLoadingTables(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedServer, selectedCaslib]);

  // Load column metadata and preview rows when table is selected
  const handleSelectTable = useCallback(async (tableName: string) => {
    const generation = invalidateSelection();
    const isCurrent = () => generation === selectionRef.current;

    setSelectedTable(tableName);
    setColumns([]);
    setPreviewRows([]);
    setMapping({});
    setError(null);
    setNotice(null);

    if (!tableName) return;

    // Get row count from the table info we already have
    const tableInfo = tables.find(t => t.name === tableName);
    setTotalRowCount(tableInfo?.rowCount ?? 0);

    setLoadingRows(true);
    try {
      // Fetch column metadata via dataTables endpoint
      const cols = await getTableColumns(selectedServer, selectedCaslib, tableName);
      if (!isCurrent()) return;
      setColumns(cols);

      // Auto-map columns to parameters
      const colNames = cols.map(c => c.name);
      setMapping(autoMapColumns(colNames, parameters));

      // Fetch a small row preview (best-effort — don't fail if this errors)
      try {
        const preview = await getTableRows(selectedServer, selectedCaslib, tableName, 0, 5);
        if (!isCurrent()) return;
        setPreviewRows(preview.rows);
        if (preview.count > 0) {
          setTotalRowCount(preview.count);
        }
      } catch (previewErr: unknown) {
        if (!isCurrent()) return;
        const pe = previewErr as { message?: string };
        console.warn('Row preview failed:', pe.message);
      }
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load table data');
    } finally {
      if (isCurrent()) setLoadingRows(false);
    }
  }, [selectedServer, selectedCaslib, parameters, tables]);

  const handleMappingChange = useCallback((paramName: string, colName: string | null) => {
    setMapping(prev => ({ ...prev, [paramName]: colName }));
  }, []);

  const [fetchingForScore, setFetchingForScore] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null);

  const handleRunAll = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;

    setError(null);
    setNotice(null);
    setFetchingForScore(true);

    const effectiveLimit = scoreFullTable ? totalRowCount : Math.min(rowLimit, totalRowCount);
    setFetchProgress({ loaded: 0, total: scoreFullTable ? (totalRowCount || null) : effectiveLimit });

    try {
      let fetched: unknown[][];
      if (scoreFullTable) {
        // Page through the whole table; the walker honours the page size the
        // service actually applies, so a capped page continues instead of
        // silently scoring a subset.
        const result = await getAllTableRows(
          selectedServer,
          selectedCaslib,
          selectedTable,
          progress => setFetchProgress(progress)
        );
        fetched = result.rows;
        if (result.count > 0) setTotalRowCount(result.count);
        if (result.truncated) {
          setNotice(
            `Only the first ${fetched.length.toLocaleString()} rows could be fetched (page cap reached); scoring those.`
          );
        }
      } else {
        // The service is not guaranteed to honour the requested limit, so the
        // loop pages until the limit is reached and the result is sliced to it.
        fetched = await fetchRowsUpTo(
          selectedServer,
          selectedCaslib,
          selectedTable,
          effectiveLimit,
          progress => setFetchProgress(progress)
        );
      }

      if (fetched.length === 0) {
        setError('No rows returned from the table');
        return;
      }

      // Resolve each parameter's column once (first-wins on duplicate names,
      // matching indexOf) instead of a linear search per row × parameter.
      const colIndexByName = new Map<string, number>();
      columns.forEach((c, i) => {
        if (!colIndexByName.has(c.name)) colIndexByName.set(c.name, i);
      });
      const mapped: { name: string; type: string; colName: string; colIndex: number }[] = [];
      for (const param of parameters) {
        const colName = mapping[param.name];
        const colIndex = colName ? colIndexByName.get(colName) : undefined;
        if (colName && colIndex !== undefined) {
          mapped.push({ name: param.name, type: param.type, colName, colIndex });
        }
      }

      const rows: Record<string, unknown>[] = fetched.map(row => {
        const rowData: Record<string, unknown> = {};
        for (const m of mapped) {
          rowData[m.name] = convertValue(getCellValue(row, m.colName, m.colIndex), m.type);
        }
        return rowData;
      });

      onExecuteBatch(rows, concurrency);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to fetch table rows');
    } finally {
      setFetchingForScore(false);
      setFetchProgress(null);
    }
  }, [selectedServer, selectedCaslib, selectedTable, scoreFullTable, totalRowCount, rowLimit, columns, mapping, parameters, concurrency, onExecuteBatch]);

  const unmappedParams = parameters.filter(p => !mapping[p.name]);
  const allMapped = unmappedParams.length === 0;
  const mappedCount = parameters.length - unmappedParams.length;

  const filteredTables = tableFilter
    ? tables.filter(t => t.name.toLowerCase().includes(tableFilter.toLowerCase()))
    : tables;

  const effectiveRowCount = scoreFullTable ? totalRowCount : Math.min(rowLimit, totalRowCount);

  const fetchLabel = fetchProgress && fetchProgress.loaded > 0
    ? `Fetching rows... ${fetchProgress.loaded.toLocaleString()}${fetchProgress.total ? ` of ${fetchProgress.total.toLocaleString()}` : ''}`
    : 'Fetching rows...';

  return (
    <Card className="cas-table-score">
      <CardHeader>
        <h3>CAS Table</h3>
      </CardHeader>
      <CardBody>
        {/* Server & Caslib Selection */}
        <div className="cas-table-score__browser">
          <div className="cas-table-score__selectors">
            <div className="cas-table-score__field">
              <label className="cas-table-score__label" htmlFor="cas-server-select">CAS Server</label>
              {loadingServers ? (
                <span className="cas-table-score__loading-text" role="status">Loading servers...</span>
              ) : (
                <select
                  id="cas-server-select"
                  className="sas-input"
                  value={selectedServer}
                  onChange={e => handleServerChange(e.target.value)}
                  disabled={executing}
                >
                  {servers.length === 0 && <option value="">No servers available</option>}
                  {servers.map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="cas-table-score__field">
              <label className="cas-table-score__label" htmlFor="cas-caslib-select">Caslib</label>
              {loadingCaslibs ? (
                <span className="cas-table-score__loading-text" role="status">Loading caslibs...</span>
              ) : (
                <select
                  id="cas-caslib-select"
                  className="sas-input"
                  value={selectedCaslib}
                  onChange={e => setSelectedCaslib(e.target.value)}
                  disabled={executing || !selectedServer}
                >
                  {caslibs.length === 0 && <option value="">No caslibs available</option>}
                  {caslibs.map(c => (
                    <option key={c.name} value={c.name}>
                      {c.name}{c.description ? ` - ${c.description}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Table List */}
          {selectedCaslib && (
            <div className="cas-table-score__table-list">
              <div className="cas-table-score__table-header">
                <span className="cas-table-score__label" id="cas-tables-label">
                  Tables {!loadingTables && `(${filteredTables.length})`}
                </span>
                <input
                  type="search"
                  className="sas-input cas-table-score__filter"
                  placeholder="Filter tables..."
                  aria-label="Filter tables"
                  value={tableFilter}
                  onChange={e => setTableFilter(e.target.value)}
                  disabled={executing || loadingTables}
                />
              </div>
              {loadingTables ? (
                <span className="cas-table-score__loading-text" role="status">Loading tables...</span>
              ) : filteredTables.length === 0 ? (
                <span className="cas-table-score__empty">
                  {tableFilter ? 'No tables match filter' : 'No tables in this caslib'}
                </span>
              ) : (
                <div className="cas-table-score__table-grid" role="group" aria-labelledby="cas-tables-label">
                  {filteredTables.map(t => (
                    <button
                      key={t.name}
                      type="button"
                      className={`cas-table-score__table-item ${selectedTable === t.name ? 'cas-table-score__table-item--selected' : ''}`}
                      onClick={() => handleSelectTable(t.name)}
                      disabled={executing}
                      aria-pressed={selectedTable === t.name}
                    >
                      <span className="cas-table-score__table-name">{t.name}</span>
                      {t.rowCount != null && (
                        <span className="cas-table-score__table-rows">{t.rowCount.toLocaleString()} rows</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <Alert variant="error" title="Error" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Catalogue failure — owned by the hook, so there is nothing to dismiss */}
        {!error && casError && (
          <Alert variant="error" title="Error">{casError}</Alert>
        )}

        {notice && (
          <Alert variant="warning" dismissible onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {/* Loading rows indicator */}
        {loadingRows && (
          <div className="cas-table-score__loading-text" role="status">Loading table data...</div>
        )}

        {/* Column Mapping (shown after table selection) */}
        {columns.length > 0 && !loadingRows && (
          <div className="cas-table-score__mapping-section column-mapping">
            <div className="column-mapping__header">
              <h4>Column Mapping</h4>
              <Badge variant={allMapped ? 'success' : 'warning'}>
                {mappedCount}/{parameters.length} mapped
              </Badge>
            </div>

            <div className="column-mapping__grid">
              {parameters.map(param => (
                <div key={param.name} className="column-mapping__row">
                  <div className="column-mapping__param-info">
                    <span className="column-mapping__param-name">{param.name}</span>
                    <TypeBadge type={param.type} />
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="column-mapping__arrow"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <select
                    value={mapping[param.name] || ''}
                    onChange={(e) => handleMappingChange(param.name, e.target.value || null)}
                    className={`sas-input column-mapping__select ${mapping[param.name] ? 'column-mapping__select--mapped' : 'column-mapping__select--unmapped'}`}
                    aria-label={`Column for ${param.name}`}
                    disabled={executing}
                  >
                    <option value="">-- Select column --</option>
                    {columns.map(col => (
                      <option key={col.name} value={col.name}>
                        {col.name} ({col.type})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Data Preview */}
            <div className="column-mapping__preview">
              <h4>Data Preview ({totalRowCount.toLocaleString()} rows in table)</h4>
              {previewRows.length > 0 ? (
                <div className="column-mapping__preview-table-wrapper">
                  <table className="sas-table sas-table--compact column-mapping__preview-table">
                    <thead className="sas-table__head">
                      <tr>
                        <th className="sas-table__th">#</th>
                        {columns.map(col => (
                          <th className="sas-table__th" key={col.name}>{col.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 5).map((row, index) => (
                        <tr className="sas-table__row" key={index}>
                          <td className="sas-table__td">{index + 1}</td>
                          {columns.map((col, colIndex) => {
                            const cell = getCellValue(row, col.name, colIndex);
                            return (
                              <td className="sas-table__td" key={col.name}>{cell != null ? String(cell) : ''}</td>
                            );
                          })}
                        </tr>
                      ))}
                      {totalRowCount > 5 && (
                        <tr className="column-mapping__preview-more">
                          <td className="sas-table__td" colSpan={columns.length + 1}>
                            ... and {(totalRowCount - 5).toLocaleString()} more rows
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="cas-table-score__empty">
                  {columns.length} columns found. Row preview not available.
                </p>
              )}
            </div>
          </div>
        )}
      </CardBody>

      {columns.length > 0 && !loadingRows && (
        <CardFooter>
          <div className="batch-run__controls">
            <div className="cas-table-score__options">
              <label className="cas-table-score__checkbox-label">
                <input
                  type="checkbox"
                  checked={scoreFullTable}
                  onChange={e => setScoreFullTable(e.target.checked)}
                  disabled={executing}
                />
                <span>Score full table ({totalRowCount.toLocaleString()} rows)</span>
              </label>
              {!scoreFullTable && (
                <div className="cas-table-score__row-limit">
                  <label htmlFor="cas-row-limit" className="batch-run__label">
                    Row Limit:
                  </label>
                  <input
                    id="cas-row-limit"
                    type="number"
                    min="1"
                    max={totalRowCount}
                    value={rowLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1) {
                        setRowLimit(val);
                      }
                    }}
                    className="sas-input batch-run__number-input"
                    disabled={executing}
                  />
                </div>
              )}
            </div>

            <div className="batch-run__concurrency">
              <label htmlFor="cas-concurrency-input" className="batch-run__label">
                Parallel Requests:
              </label>
              <input
                id="cas-concurrency-input"
                type="number"
                min="1"
                max="100"
                value={concurrency}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= 100) {
                    setConcurrency(val);
                  }
                }}
                className="sas-input batch-run__number-input"
                disabled={executing}
              />
            </div>

            <div className="cas-table-score__footer-buttons">
              {onSaveAsTest && (
                <Button
                  variant="secondary"
                  size="large"
                  onClick={() => onSaveAsTest({
                    serverName: selectedServer,
                    libraryName: selectedCaslib,
                    tableName: selectedTable,
                    columnMappings: mapping,
                  })}
                  disabled={!allMapped || executing}
                >
                  Save as Test
                </Button>
              )}
              <Button
                variant="primary"
                size="large"
                onClick={handleRunAll}
                disabled={!allMapped || executing || fetchingForScore || totalRowCount === 0}
                loading={executing || fetchingForScore}
              >
                {executing ? 'Executing...' : fetchingForScore ? fetchLabel : `Run All (${effectiveRowCount.toLocaleString()} rows)`}
              </Button>
            </div>
          </div>
          {/* Live region so the paged fetch is announced without re-reading the button */}
          <span className="sr-only" role="status" aria-live="polite">
            {fetchingForScore ? fetchLabel : ''}
          </span>
          {!allMapped && (
            <span className="batch-run__warning" role="status">
              Please map all input parameters before running
            </span>
          )}
          {allMapped && effectiveRowCount > LARGE_RUN_WARNING && (
            <span className="batch-run__warning" role="status">
              Scoring {effectiveRowCount.toLocaleString()} rows sends one request per row and keeps every row in memory until the run finishes.
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  );
};

export default CasTableScore;
