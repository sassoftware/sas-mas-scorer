// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios, { CanceledError } from 'axios';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { ProgressBar } from '../common/ProgressBar';
import { useThrottledAnnouncement } from './useThrottledAnnouncement';
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
import { ExpectedOutputsMapping } from './ExpectedOutputsMapping';
import { LoadTestDialog } from './LoadTestDialog';
import { buildReverseNameLookup } from './scenarioMapping';
import { DecisionSignatureVariable } from '../../api/modules';
import { ScoreTestDefinition } from '../../api/scoreTests';
import {
  ExpectedSources,
  InputSource,
  InputSources,
  MappingNote,
  autoMapColumns,
  columnMappingsOf,
  describeIssue,
  expectedRowsOf,
  suggestExpectedColumns,
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
  /** The step's outputs, for the optional expected-output columns */
  outputParameters?: StepParameter[];
  /** `expected` holds each row's expected outputs, or null when nothing is compared */
  onExecuteBatch: (
    rows: Record<string, unknown>[],
    concurrency: number,
    expected?: Record<string, unknown>[] | null
  ) => void;
  executing: boolean;
  onSaveAsTest?: (info: CasTableTestInfo) => void;
  /** Enables "Load Test…" for a decision: its source URI and signature */
  testSource?: {
    sourceURI: string;
    signature: DecisionSignatureVariable[];
    /** Called when the dialog opens (lets the panel retry a failed signature fetch) */
    onOpen?: () => void;
  };
}

/** A loaded test's table and mapping, waiting for the selections to reach it. */
interface TestPreset {
  testName: string;
  serverName: string;
  libraryName: string;
  tableName: string;
  /** MAS input → CAS column, as the test maps it */
  columns: Record<string, string>;
  /** Mapped decision variables that match no input of this step */
  unknownVariables: string[];
}

const NO_OUTPUTS: StepParameter[] = [];
const NO_EXPECTED: ExpectedSources = {};

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
 * `signal` cancels the page request in flight (axios CanceledError).
 */
const fetchRowsUpTo = async (
  serverName: string,
  caslibName: string,
  tableName: string,
  limit: number,
  onProgress: (progress: FetchProgress) => void,
  signal?: AbortSignal
): Promise<unknown[][]> => {
  const rows: unknown[][] = [];
  let start = 0;
  for (let page = 0; page < LIMITED_FETCH_MAX_PAGES && rows.length < limit; page++) {
    const want = Math.min(LIMITED_FETCH_PAGE, limit - rows.length);
    const result = await getTableRows(serverName, caslibName, tableName, start, want, { signal });
    if (result.rows.length === 0) break;
    for (const row of result.rows) rows.push(row);
    start += result.rows.length;
    onProgress({ loaded: Math.min(rows.length, limit), total: limit });

    // Compare against the page size the service echoed, not the one requested
    const echoedLimit = result.limit > 0 ? result.limit : want;
    if (result.rows.length < echoedLimit) break;
    if (result.count > 0 && start >= result.count) break;
  }
  // Trimmed in place: a copy would hold the rows twice
  if (rows.length > limit) rows.length = limit;
  return rows;
};

export const CasTableScore: React.FC<CasTableScoreProps> = ({
  parameters,
  outputParameters = NO_OUTPUTS,
  onExecuteBatch,
  executing,
  onSaveAsTest,
  testSource,
}) => {
  // Browse state. The server/caslib catalogue comes from the shared session
  // cache; tables are still fetched per caslib (cas.ts is unchanged).
  const [tables, setTables] = useState<CasTableInfo[]>([]);
  // `${server}|${caslib}` the tables were listed for ('' while none are)
  const [tablesFor, setTablesFor] = useState('');
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
  // Optional expected-output columns, and what was suggested by name
  const [expectedSources, setExpectedSources] = useState<ExpectedSources>(NO_EXPECTED);
  const [suggestedExpected, setSuggestedExpected] = useState<ExpectedSources>(NO_EXPECTED);
  // Load Test: the dialog, the test on its way through the selections and what was applied
  const [showLoadTest, setShowLoadTest] = useState(false);
  const presetRef = useRef<TestPreset | null>(null);
  const [presetTick, setPresetTick] = useState(0);
  const [loadedTestNote, setLoadedTestNote] = useState<string | null>(null);
  const [scoreFullTable, setScoreFullTable] = useState(false);
  const [rowLimit, setRowLimit] = useState<number>(DEFAULT_ROW_LIMIT);
  const [concurrency, setConcurrency] = useState<number>(2);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Rows fetched for a run whose values include some that cannot be read;
  // held until the user confirms sending them as missing (or cancels).
  const [pendingRun, setPendingRun] = useState<{
    rows: Record<string, unknown>[];
    expected: Record<string, unknown>[] | null;
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
  // A test being loaded wants its own caslib instead.
  useEffect(() => {
    if (caslibs.length === 0) {
      setSelectedCaslib('');
      return;
    }
    const preset = presetRef.current;
    if (preset) {
      const lib = caslibs.find(c => c.name === preset.libraryName)
        ?? caslibs.find(c => c.name.toLowerCase() === preset.libraryName.toLowerCase());
      if (lib) {
        setSelectedCaslib(lib.name);
        return;
      }
      presetRef.current = null;
      setNotice(`The test “${preset.testName}” reads caslib ${preset.libraryName}, which is not available to you on ${preset.serverName}. Only the server was changed.`);
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
    setTablesFor('');
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
      setTablesFor('');
      return;
    }

    let cancelled = false;
    const load = async () => {
      invalidateSelection();
      setLoadingTables(true);
      setTablesFor('');
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
        setTablesFor(`${selectedServer}|${selectedCaslib}`);
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
  // `preset` is a loaded test's mapping, applied instead of the auto-mapping
  const handleSelectTable = useCallback(async (tableName: string, preset?: TestPreset) => {
    const generation = invalidateSelection();
    const isCurrent = () => generation === selectionRef.current;

    setSelectedTable(tableName);
    setColumns([]);
    setPreviewRows([]);
    setSources({});
    setExpectedSources(NO_EXPECTED);
    setSuggestedExpected(NO_EXPECTED);
    setError(null);
    setNotice(null);
    setPendingRun(null);
    if (!preset) setLoadedTestNote(null);

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

      // Auto-map columns to parameters, or apply the loaded test's mapping
      const colNames = cols.map(c => c.name);
      let nextSources: InputSources;
      if (preset) {
        const byLower = new Map(colNames.map(n => [n.toLowerCase(), n] as const));
        nextSources = {};
        const absent: string[] = [];
        let mapped = 0;
        let missing = 0;
        for (const param of parameters) {
          const wanted = preset.columns[param.name];
          if (!wanted) {
            // A test leaves an input without a mapping missing
            nextSources[param.name] = { kind: 'missing' };
            missing++;
            continue;
          }
          const column = byLower.get(wanted.toLowerCase());
          if (column) {
            nextSources[param.name] = { kind: 'column', column };
            mapped++;
          } else {
            nextSources[param.name] = { kind: 'unset' };
            absent.push(`${param.name} → ${wanted}`);
          }
        }
        setLoadedTestNote(
          `Loaded test “${preset.testName}”: ${mapped} input${mapped === 1 ? '' : 's'} mapped to columns` +
          (missing ? `, ${missing} sent as missing (the test does not map them)` : '') + '.'
        );
        const problems: string[] = [];
        if (absent.length) problems.push(`These mapped columns are not in the table, so their inputs need a source: ${absent.join(', ')}.`);
        if (preset.unknownVariables.length) problems.push(`These mapped decision variables match no input of this step and were skipped: ${preset.unknownVariables.join(', ')}.`);
        if (problems.length) setNotice(problems.join(' '));
      } else {
        nextSources = autoMapColumns(colNames, parameters);
      }
      setSources(nextSources);
      const suggestions = suggestExpectedColumns(colNames, outputParameters, nextSources);
      setSuggestedExpected(suggestions);
      setExpectedSources(suggestions);

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
  }, [selectedServer, selectedCaslib, parameters, outputParameters, tables]);

  // A loaded test reaches its table once the tables of its caslib are listed
  useEffect(() => {
    const preset = presetRef.current;
    if (!preset || loadingTables) return;
    if (tablesFor !== `${preset.serverName}|${preset.libraryName}`) return;
    presetRef.current = null;
    const table = tables.find(t => t.name === preset.tableName)
      ?? tables.find(t => t.name.toLowerCase() === preset.tableName.toLowerCase());
    if (!table) {
      setNotice(
        `The test “${preset.testName}” reads table ${preset.tableName}, which is not listed in ${preset.libraryName} ` +
        '(only tables with rows are listed). Load it into CAS, then load the test again.'
      );
      return;
    }
    handleSelectTable(table.name, preset);
  }, [tables, tablesFor, loadingTables, presetTick, handleSelectTable]);

  // Apply a test chosen in Load Test: server, caslib and table in turn (each
  // resets what lies below it), then the test's mapping instead of the auto-map.
  const handleLoadTest = useCallback((test: ScoreTestDefinition) => {
    const data = test.inputData;
    const serverName = data?.serverName;
    const libraryName = data?.libraryName;
    const tableName = data?.tableName;
    if (!serverName || !libraryName || !tableName) return;
    setError(null);
    setNotice(null);
    setLoadedTestNote(null);
    if (!servers.some(s => s.name === serverName)) {
      setNotice(`The test “${test.name}” reads from CAS server ${serverName}, which is not available here. Nothing was changed.`);
      return;
    }
    const resolve = buildReverseNameLookup(testSource?.signature ?? [], parameters);
    const columns: Record<string, string> = {};
    const unknownVariables: string[] = [];
    for (const m of test.mappings ?? []) {
      if (m.mappingType !== 'datasource' || typeof m.mappingValue !== 'string' || !m.mappingValue) continue;
      const input = resolve(m.variableName);
      if (input) columns[input] = m.mappingValue;
      else unknownVariables.push(m.variableName);
    }
    presetRef.current = {
      testName: test.name,
      serverName,
      libraryName,
      tableName,
      columns,
      unknownVariables,
    };
    setTableFilter('');
    if (serverName !== selectedServer) {
      handleServerChange(serverName);
      return;
    }
    const lib = caslibs.find(c => c.name === libraryName)
      ?? caslibs.find(c => c.name.toLowerCase() === libraryName.toLowerCase());
    if (!lib) {
      presetRef.current = null;
      setNotice(`The test “${test.name}” reads caslib ${libraryName}, which is not available to you on ${serverName}. Nothing was changed.`);
      return;
    }
    if (lib.name === selectedCaslib) setPresetTick(n => n + 1);
    else setSelectedCaslib(lib.name);
  }, [servers, caslibs, selectedServer, selectedCaslib, parameters, testSource, handleServerChange]);

  const handleExpectedChange = useCallback((output: string, column: string | null) => {
    setPendingRun(null);
    setExpectedSources(prev => {
      const next = { ...prev };
      if (column) next[output] = column;
      else delete next[output];
      return next;
    });
  }, []);

  const handleClearExpected = useCallback(() => {
    setPendingRun(null);
    setExpectedSources(NO_EXPECTED);
  }, []);

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
  // Cancels the row fetch of a run: Stop, or leaving the page mid-fetch
  const fetchControllerRef = useRef<AbortController | null>(null);

  // Stop fetching removes its own button; focus goes back to Run All
  const refocusRunRef = useRef(false);

  useEffect(() => () => fetchControllerRef.current?.abort(), []);

  useEffect(() => {
    if (fetchingForScore || !refocusRunRef.current) return;
    refocusRunRef.current = false;
    document.getElementById('cas-run-all')?.focus();
  }, [fetchingForScore]);

  const handleStopFetch = useCallback(() => {
    refocusRunRef.current = true;
    fetchControllerRef.current?.abort();
  }, []);

  const handleRunAll = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;

    setError(null);
    setNotice(null);
    setPendingRun(null);
    setFetchingForScore(true);
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const { signal } = controller;

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
          progress => setFetchProgress(progress),
          { signal }
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
          progress => setFetchProgress(progress),
          signal
        );
      }
      // Stopped while the last page was being handled
      if (signal.aborted) throw new CanceledError();

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
      // Expected values as the table holds them (cells are trimmed text; SAS
      // missing is '.'); the comparison normalises them
      const columnIndex = new Map<string, number>();
      columns.forEach((c, i) => {
        if (!columnIndex.has(c.name)) columnIndex.set(c.name, i);
      });
      const expected = expectedRowsOf(fetched, expectedSources, (row, column) => {
        const index = columnIndex.get(column);
        return index === undefined ? undefined : getCellValue(row, column, index);
      });
      // `fetched` (the raw cells) is released when this handler returns, which
      // is before the first scoring request completes: onExecuteBatch is not
      // awaited, so only the converted input records stay for the run.
      if (report.issueCount > 0) {
        setPendingRun({ rows, expected, report });
        return;
      }

      onExecuteBatch(rows, concurrency, expected);
    } catch (err: unknown) {
      // Stopped (or the panel unmounted, where the notice goes nowhere)
      if (axios.isCancel(err)) {
        setNotice('Fetching stopped. Nothing was scored.');
        return;
      }
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to fetch table rows');
    } finally {
      if (fetchControllerRef.current === controller) fetchControllerRef.current = null;
      setFetchingForScore(false);
      setFetchProgress(null);
    }
  }, [selectedServer, selectedCaslib, selectedTable, scoreFullTable, totalRowCount, rowLimit, columns, sources, expectedSources, parameters, concurrency, onExecuteBatch]);

  const handleConfirmPendingRun = useCallback(() => {
    if (!pendingRun) return;
    setPendingRun(null);
    onExecuteBatch(pendingRun.rows, concurrency, pendingRun.expected);
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
  // A page lands every second or two; screen readers hear it every 10 s
  const fetchAnnouncement = useThrottledAnnouncement(fetchingForScore ? fetchLabel : '');

  return (
    <Card className="cas-table-score">
      <CardHeader
        actions={testSource ? (
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              testSource.onOpen?.();
              setShowLoadTest(true);
            }}
            disabled={executing || fetchingForScore || loadingServers}
            title="Select the table and apply the column mapping of a test saved for this decision"
          >
            Load Test…
          </Button>
        ) : undefined}
      >
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
                  onChange={e => {
                    presetRef.current = null;
                    handleServerChange(e.target.value);
                  }}
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
                  onChange={e => {
                    presetRef.current = null;
                    setSelectedCaslib(e.target.value);
                  }}
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
                      onClick={() => {
                        presetRef.current = null;
                        handleSelectTable(t.name);
                      }}
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

        {loadedTestNote && (
          <Alert variant="info" dismissible onClose={() => setLoadedTestNote(null)}>
            {loadedTestNote}
          </Alert>
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

            <ExpectedOutputsMapping
              idPrefix="cas-expected"
              outputs={outputParameters}
              columns={columns.map(col => ({ name: col.name, label: `${col.name} (${col.type})` }))}
              expected={expectedSources}
              suggested={suggestedExpected}
              onChange={handleExpectedChange}
              onClearAll={handleClearExpected}
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
                id="cas-run-all"
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
          {fetchingForScore && (
            <div className="cas-table-score__fetch">
              <ProgressBar
                value={fetchProgress?.total ? fetchProgress.loaded : undefined}
                max={fetchProgress?.total ?? undefined}
                label="Fetching table rows"
                phase="Fetching rows"
                count={fetchProgress && fetchProgress.loaded > 0
                  ? `${fetchProgress.loaded.toLocaleString()}${fetchProgress.total ? ` of ${fetchProgress.total.toLocaleString()}` : ''}`
                  : undefined}
                message="Nothing is scored until every row has been fetched."
                className="cas-table-score__fetch-progress"
              />
              <Button variant="danger" size="small" onClick={handleStopFetch}>
                Stop fetching
              </Button>
            </div>
          )}
          {/* Live region so the paged fetch is announced without re-reading the button */}
          <span className="sr-only" role="status" aria-live="polite">
            {fetchAnnouncement}
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

      {showLoadTest && testSource && (
        <LoadTestDialog
          sourceURI={testSource.sourceURI}
          onLoad={handleLoadTest}
          onClose={() => setShowLoadTest(false)}
        />
      )}
    </Card>
  );
};

export default CasTableScore;
