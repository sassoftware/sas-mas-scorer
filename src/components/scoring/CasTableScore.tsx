// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import {
  getCasTables,
  getTableColumns,
  getTableRows,
  getAllTableRows,
  CasTableInfo,
  CasColumnInfo,
} from '../../api/cas';
import { useCasCatalog } from '../../hooks/useCasCatalog';
import {
  ConversionReport,
  MappedColumn,
  convertMappedRows,
  scanMappedRows,
} from '../../utils/fileFormats';
import { ColumnMappingGrid } from './ColumnMappingGrid';
import {
  InputSource,
  InputSources,
  MappingNote,
  autoMapColumns,
  columnMappingsOf,
  describeIssue,
  fixedInputValues,
  mergeNotes,
  notesFromReport,
  sourceOf,
  summarizeSources,
  unsetToMissing,
} from './inputMapping';

export interface CasTableTestInfo {
  serverName: string;
  libraryName: string;
  tableName: string;
  /** Input → CAS column; null for every input not read from a column. */
  columnMappings: Record<string, string | null>;
  /** Inputs the user chose to send as missing (shown as such in the dialog). */
  missingInputs?: string[];
}

interface CasTableScoreProps {
  parameters: StepParameter[];
  onExecuteBatch: (rows: Record<string, unknown>[], concurrency: number) => void;
  executing: boolean;
  onSaveAsTest?: (info: CasTableTestInfo) => void;
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

// CAS column types that hold numbers, and those that hold text.
const NUMERIC_CAS_TYPES = new Set(['double', 'int32', 'int64', 'decimal', 'decquad', 'decsect']);
const CHAR_CAS_TYPES = new Set(['char', 'varchar']);
const NUMERIC_PARAM_TYPES = new Set(['decimal', 'integer', 'bigint', 'decimalArray', 'integerArray', 'bigintArray']);

const isNumericCasColumn = (col: CasColumnInfo | undefined): boolean =>
  !!col && NUMERIC_CAS_TYPES.has(col.type.toLowerCase());

// Converter columns for the column-mapped inputs (first column wins on a
// duplicate name, as indexOf always did).
const mappedCasColumns = (
  columns: CasColumnInfo[],
  parameters: StepParameter[],
  sources: InputSources
): MappedColumn<unknown>[] => {
  const indexByName = new Map<string, number>();
  columns.forEach((c, i) => {
    if (!indexByName.has(c.name)) indexByName.set(c.name, i);
  });
  const mapped: MappedColumn<unknown>[] = [];
  for (const param of parameters) {
    const source = sourceOf(sources, param.name);
    if (source.kind !== 'column') continue;
    const colIndex = indexByName.get(source.column);
    if (colIndex === undefined) continue;
    const colName = source.column;
    mapped.push({
      name: param.name,
      type: param.type,
      column: colName,
      read: row => getCellValue(row, colName, colIndex),
      // A numeric column sent to a string input: its SAS missing '.' is null
      options: { numericSource: isNumericCasColumn(columns[colIndex]) },
    });
  }
  return mapped;
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
  const [sources, setSources] = useState<InputSources>({});
  const [scoreFullTable, setScoreFullTable] = useState(false);
  const [rowLimit, setRowLimit] = useState<number>(DEFAULT_ROW_LIMIT);
  const [concurrency, setConcurrency] = useState<number>(2);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Rows fetched for a run whose values include some that cannot be read;
  // held until the user confirms sending them as missing (or cancels).
  const [pendingRun, setPendingRun] = useState<{
    rows: Record<string, unknown>[];
    report: ConversionReport;
  } | null>(null);

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
    setPendingRun(null);
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
      setPendingRun(null);
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
    setSources({});
    setError(null);
    setNotice(null);
    setPendingRun(null);

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
      setSources(autoMapColumns(colNames, parameters));

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

  const handleSourceChange = useCallback((paramName: string, source: InputSource) => {
    setPendingRun(null);
    setSources(prev => ({ ...prev, [paramName]: source }));
  }, []);

  const handleUnsetToMissing = useCallback(() => {
    setPendingRun(null);
    setSources(prev => unsetToMissing(parameters, prev));
  }, [parameters]);

  const summary = useMemo(() => summarizeSources(parameters, sources), [parameters, sources]);

  const [fetchingForScore, setFetchingForScore] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null);

  const handleRunAll = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;

    setError(null);
    setNotice(null);
    setPendingRun(null);
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

      // Convert once; unreadable values (not SAS missing — those are null by
      // design) stop here for a confirmation instead of being scored as 0.
      const { rows, report } = convertMappedRows(
        fetched,
        mappedCasColumns(columns, parameters, sources),
        fixedInputValues(parameters, sources)
      );
      if (report.issueCount > 0) {
        setPendingRun({ rows, report });
        return;
      }

      onExecuteBatch(rows, concurrency);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to fetch table rows');
    } finally {
      setFetchingForScore(false);
      setFetchProgress(null);
    }
  }, [selectedServer, selectedCaslib, selectedTable, scoreFullTable, totalRowCount, rowLimit, columns, sources, parameters, concurrency, onExecuteBatch]);

  const handleConfirmPendingRun = useCallback(() => {
    if (!pendingRun) return;
    setPendingRun(null);
    onExecuteBatch(pendingRun.rows, concurrency);
  }, [pendingRun, concurrency, onExecuteBatch]);

  // Mapping notes: a column whose CAS type conflicts with the input's type,
  // and values in the preview rows that cannot be read. The full table is only
  // fetched at run time, where the same check runs on every row.
  const notes = useMemo(() => {
    const byName = new Map(columns.map(c => [c.name, c] as const));
    const typeNotes: Record<string, MappingNote[]> = {};
    for (const param of parameters) {
      const source = sourceOf(sources, param.name);
      if (source.kind !== 'column') continue;
      const col = byName.get(source.column);
      if (!col) continue;
      const colType = col.type.toLowerCase();
      if (NUMERIC_PARAM_TYPES.has(param.type) && CHAR_CAS_TYPES.has(colType)) {
        typeNotes[param.name] = [{
          tone: 'warning',
          text: `${col.name} is a character column (${col.type}) mapped to a numeric input; values that are not numbers are sent as missing (null).`,
        }];
      } else if (param.type === 'string' && NUMERIC_CAS_TYPES.has(colType)) {
        typeNotes[param.name] = [{
          tone: 'info',
          text: `${col.name} is a numeric column (${col.type}); its values are sent as text and SAS missing values as null.`,
        }];
      }
    }
    const previewNotes: Record<string, MappingNote[]> = {};
    if (previewRows.length > 0) {
      const previewReport = scanMappedRows(previewRows, mappedCasColumns(columns, parameters, sources));
      for (const [input, list] of Object.entries(notesFromReport(previewReport))) {
        previewNotes[input] = list.map(n => ({ ...n, text: `Preview rows: ${n.text}` }));
      }
    }
    return mergeNotes(typeNotes, previewNotes);
  }, [columns, parameters, sources, previewRows]);

  // Save as Test stores column mappings only. A constant has no verified SID
  // mapping for a CAS-table test yet, so a setup with constants is not saved
  // rather than saved differently from what is scored here.
  const canSaveAsTest = summary.ready && summary.constant === 0 && summary.mapped > 0;

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
            <ColumnMappingGrid
              idPrefix="cas-mapping"
              parameters={parameters}
              columns={columns.map(col => ({ name: col.name, label: `${col.name} (${col.type})` }))}
              sources={sources}
              summary={summary}
              onChange={handleSourceChange}
              onSetUnsetToMissing={handleUnsetToMissing}
              notes={notes}
              disabled={executing || fetchingForScore}
            />

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
                    columnMappings: columnMappingsOf(parameters, sources),
                    missingInputs: parameters
                      .filter(p => sourceOf(sources, p.name).kind === 'missing')
                      .map(p => p.name),
                  })}
                  disabled={!canSaveAsTest || executing}
                  aria-describedby={summary.ready && summary.constant > 0 ? 'cas-save-test-constant-hint' : undefined}
                >
                  Save as Test
                </Button>
              )}
              <Button
                variant="primary"
                size="large"
                onClick={handleRunAll}
                disabled={!summary.ready || executing || fetchingForScore || totalRowCount === 0 || pendingRun !== null}
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
          {pendingRun && (
            <div className="batch-run__confirm">
              <Alert
                variant="warning"
                title={`${pendingRun.report.issueCount.toLocaleString()} value${pendingRun.report.issueCount === 1 ? '' : 's'} can't be read`}
                actions={
                  <>
                    <Button variant="primary" size="small" onClick={handleConfirmPendingRun}>
                      Score {pendingRun.rows.length.toLocaleString()} rows anyway
                    </Button>
                    <Button variant="tertiary" size="small" onClick={() => setPendingRun(null)}>
                      Cancel
                    </Button>
                  </>
                }
              >
                <p className="batch-run__confirm-text">
                  Nothing has been scored yet. These values do not fit their input&rsquo;s type and would be sent as missing (null), not 0:
                </p>
                <ul className="batch-run__confirm-list">
                  {pendingRun.report.issues.map(issue => (
                    <li key={issue.input}>
                      <strong>{issue.input}</strong>: {describeIssue(issue)}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
          {summary.unset > 0 && (
            <span className="batch-run__warning" role="status">
              Choose a column, &ldquo;Send as missing&rdquo; or a constant for every input before running
              ({summary.unset} not set)
            </span>
          )}
          {summary.unset === 0 && summary.invalidConstants.length > 0 && (
            <span className="batch-run__warning" role="status">
              Fix the constant value for {summary.invalidConstants.join(', ')} before running
            </span>
          )}
          {onSaveAsTest && summary.ready && summary.constant > 0 && (
            <span className="batch-run__warning" id="cas-save-test-constant-hint">
              Save as Test needs a column or &ldquo;Send as missing&rdquo; for every input; constants apply to runs here only.
            </span>
          )}
          {summary.ready && effectiveRowCount > LARGE_RUN_WARNING && (
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
