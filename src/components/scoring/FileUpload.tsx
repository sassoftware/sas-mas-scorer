// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import {
  FileFormatAdapter,
  MappedColumn,
  ParsedTable,
  acceptAttribute,
  adapters,
  convertMappedRows,
  findAdapter,
  scanMappedRows,
} from '../../utils/fileFormats';
import { ColumnMappingGrid } from './ColumnMappingGrid';
import { ExpectedOutputsMapping } from './ExpectedOutputsMapping';
import {
  ExpectedSources,
  InputSource,
  InputSources,
  autoMapColumns,
  expectedRowsOf,
  suggestExpectedColumns,
  fixedInputValues,
  notesFromReport,
  sourceOf,
  summarizeSources,
  unsetToMissing,
} from './inputMapping';

interface FileUploadProps {
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
}

const NO_OUTPUTS: StepParameter[] = [];
const NO_EXPECTED: ExpectedSources = {};

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const DELIMITER_PRESETS: { label: string; value: string }[] = [
  { label: 'Comma', value: ',' },
  { label: 'Tab', value: '\t' },
  { label: 'Semicolon', value: ';' },
  { label: 'Pipe', value: '|' },
];

// The column-mapped inputs as converter columns (first header wins on
// duplicates, as indexOf always did).
const mappedColumnsOf = (
  table: ParsedTable,
  parameters: StepParameter[],
  sources: InputSources
): MappedColumn<unknown[]>[] => {
  const columns: MappedColumn<unknown[]>[] = [];
  for (const param of parameters) {
    const source = sourceOf(sources, param.name);
    if (source.kind !== 'column') continue;
    const index = table.headers.indexOf(source.column);
    if (index === -1) continue;
    columns.push({
      name: param.name,
      type: param.type,
      column: source.column,
      read: row => row[index],
    });
  }
  return columns;
};

export const FileUpload: React.FC<FileUploadProps> = ({
  parameters,
  outputParameters = NO_OUTPUTS,
  onExecuteBatch,
  executing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [sources, setSources] = useState<InputSources>({});
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [currentAdapter, setCurrentAdapter] = useState<FileFormatAdapter | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [delimiter, setDelimiter] = useState<string | null>(null);
  const [customDelimiter, setCustomDelimiter] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  // Optional expected-output columns, and what was suggested by name
  const [expectedSources, setExpectedSources] = useState<ExpectedSources>(NO_EXPECTED);
  const [suggestedExpected, setSuggestedExpected] = useState<ExpectedSources>(NO_EXPECTED);

  const runAdapter = useCallback(async (
    adapter: FileFormatAdapter,
    file: File,
    opts?: { sheetName?: string; delimiter?: string },
  ) => {
    setLoading(true);
    try {
      const parsed = await adapter.parse(file, opts);

      if (parsed.headers.length === 0) {
        setError('File is empty or invalid');
        setTable(null);
        return;
      }

      setTable(parsed);
      setFormatLabel(adapter.label);
      const autoSources = autoMapColumns(parsed.headers, parameters);
      setSources(autoSources);
      const suggestions = suggestExpectedColumns(parsed.headers, outputParameters, autoSources);
      setSuggestedExpected(suggestions);
      setExpectedSources(suggestions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse file';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [parameters, outputParameters]);

  // One path for the file picker and a drop onto the upload area
  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    setFormatLabel(null);
    setTable(null);

    const adapter = findAdapter(file.name);
    if (!adapter) {
      const supported = adapters.map(a => a.label).join(', ');
      setError(`Unsupported file type. Supported formats: ${supported}`);
      setCurrentFile(null);
      setCurrentAdapter(null);
      return;
    }

    setCurrentFile(file);
    setCurrentAdapter(adapter);
    setDelimiter(adapter.defaultDelimiter ?? null);
    setCustomDelimiter('');
    await runAdapter(adapter, file);
  }, [runAdapter]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Drag and drop is the pointer shortcut; the file picker (a focusable input
  // with a visible label) stays the keyboard path. preventDefault on dragover
  // and drop also stops the browser from opening the file and leaving the app.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = executing ? 'none' : 'copy';
    if (!executing) setDragOver(true);
  }, [executing]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Moving onto a child element fires dragleave on the zone; only a pointer
    // that really left it clears the highlight.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (executing) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // A later pick of the same file must still fire the input's change event
    if (fileInputRef.current) fileInputRef.current.value = '';
    handleFile(file);
  }, [executing, handleFile]);

  const handleSheetChange = useCallback(async (sheetName: string) => {
    if (!currentFile || !currentAdapter) return;
    setError(null);
    await runAdapter(currentAdapter, currentFile, { sheetName });
  }, [currentFile, currentAdapter, runAdapter]);

  const handleDelimiterChange = useCallback(async (next: string) => {
    if (!currentFile || !currentAdapter || !next) return;
    setDelimiter(next);
    setError(null);
    await runAdapter(currentAdapter, currentFile, { delimiter: next });
  }, [currentFile, currentAdapter, runAdapter]);

  const handleSourceChange = useCallback((paramName: string, source: InputSource) => {
    setSources(prev => ({
      ...prev,
      [paramName]: source,
    }));
  }, []);

  const handleUnsetToMissing = useCallback(() => {
    setSources(prev => unsetToMissing(parameters, prev));
  }, [parameters]);

  const handleExpectedChange = useCallback((output: string, column: string | null) => {
    setExpectedSources(prev => {
      const next = { ...prev };
      if (column) next[output] = column;
      else delete next[output];
      return next;
    });
  }, []);

  const handleClearExpected = useCallback(() => setExpectedSources(NO_EXPECTED), []);

  const handleClear = useCallback(() => {
    setTable(null);
    setSources({});
    setExpectedSources(NO_EXPECTED);
    setSuggestedExpected(NO_EXPECTED);
    setFileName(null);
    setFormatLabel(null);
    setError(null);
    setCurrentFile(null);
    setCurrentAdapter(null);
    setDelimiter(null);
    setCustomDelimiter('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const summary = useMemo(() => summarizeSources(parameters, sources), [parameters, sources]);

  // Pre-flight: the whole file is converted once per column mapping (not per
  // keystroke in a constant), so unreadable values are shown before the run.
  const columnMappingKey = JSON.stringify(
    parameters.map(p => {
      const source = sourceOf(sources, p.name);
      return source.kind === 'column' ? source.column : null;
    })
  );
  const report = useMemo(() => {
    if (!table) return null;
    return scanMappedRows(table.rows, mappedColumnsOf(table, parameters, sources));
    // sources is read through columnMappingKey: constants and "missing" do not
    // change what the columns contain
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, parameters, columnMappingKey]);
  const notes = useMemo(() => (report ? notesFromReport(report) : undefined), [report]);

  const handleRunAll = useCallback(() => {
    if (!table || !summary.ready) return;
    const { rows } = convertMappedRows(
      table.rows,
      mappedColumnsOf(table, parameters, sources),
      fixedInputValues(parameters, sources)
    );
    // Expected values are read as they are in the file; the comparison
    // normalises them (numbers as text, blanks, SAS missing values)
    const headerIndex = new Map<string, number>();
    table.headers.forEach((h, i) => {
      if (!headerIndex.has(h)) headerIndex.set(h, i);
    });
    const expected = expectedRowsOf(table.rows, expectedSources, (row, column) => {
      const index = headerIndex.get(column);
      return index === undefined ? undefined : row[index];
    });
    onExecuteBatch(rows, concurrency, expected);
  }, [table, summary.ready, parameters, sources, expectedSources, onExecuteBatch, concurrency]);

  const supportedFormats = adapters.map(a => a.label).join(', ');

  return (
    <Card className="csv-upload">
      <CardHeader>
        <h3>Batch File Upload</h3>
      </CardHeader>
      <CardBody>
        <div
          className={`csv-upload__file-section csv-upload__dropzone${dragOver ? ' csv-upload__dropzone--active' : ''}`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttribute()}
            onChange={handleFileSelect}
            className="csv-upload__file-input"
            id="file-upload-input"
            aria-describedby="file-upload-hint"
            disabled={executing}
          />
          <label htmlFor="file-upload-input" className="csv-upload__file-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>{fileName || 'Choose file...'}</span>
          </label>
          {formatLabel && <Badge variant="info">{formatLabel}</Badge>}
          {fileName && (
            <Button variant="tertiary" size="small" onClick={handleClear} disabled={executing}>
              Clear
            </Button>
          )}
          <span className="csv-upload__dropzone-hint" id="file-upload-hint">
            {dragOver ? 'Drop the file to load it' : 'or drag and drop a file here'} ({supportedFormats})
          </span>
        </div>

        {error && (
          <Alert variant="error" title="Error" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading && !table && (
          <Alert variant="info" title="Parsing file...">
            Reading {fileName}
          </Alert>
        )}

        {table && currentAdapter?.defaultDelimiter !== undefined && (
          <div className="csv-upload__delimiter-picker">
            <span className="csv-upload__delimiter-label">Delimiter:</span>
            {DELIMITER_PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                className={`csv-upload__delimiter-chip ${delimiter === preset.value ? 'csv-upload__delimiter-chip--active' : ''}`}
                onClick={() => handleDelimiterChange(preset.value)}
                disabled={loading || executing}
              >
                {preset.label}
              </button>
            ))}
            <input
              type="text"
              className="sas-input csv-upload__delimiter-input"
              placeholder="Custom"
              value={customDelimiter}
              maxLength={4}
              onChange={(e) => setCustomDelimiter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customDelimiter) {
                  e.preventDefault();
                  handleDelimiterChange(customDelimiter);
                }
              }}
              onBlur={() => {
                if (customDelimiter && customDelimiter !== delimiter) {
                  handleDelimiterChange(customDelimiter);
                }
              }}
              disabled={loading || executing}
              aria-label="Custom delimiter"
            />
          </div>
        )}

        {table && table.sheetNames && table.sheetNames.length > 1 && (
          <div className="csv-upload__sheet-picker">
            <label htmlFor="sheet-select">Sheet:</label>
            <select
              id="sheet-select"
              value={table.activeSheet ?? ''}
              onChange={(e) => handleSheetChange(e.target.value)}
              disabled={loading || executing}
              className="sas-input csv-upload__sheet-select"
            >
              {table.sheetNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        {table && (
          <div className="column-mapping">
            <ColumnMappingGrid
              idPrefix="file-mapping"
              parameters={parameters}
              columns={table.headers.map(header => ({ name: header }))}
              sources={sources}
              summary={summary}
              onChange={handleSourceChange}
              onSetUnsetToMissing={handleUnsetToMissing}
              notes={notes}
              disabled={executing}
            />

            <ExpectedOutputsMapping
              idPrefix="file-expected"
              outputs={outputParameters}
              columns={table.headers.map(header => ({ name: header }))}
              expected={expectedSources}
              suggested={suggestedExpected}
              onChange={handleExpectedChange}
              onClearAll={handleClearExpected}
              disabled={executing}
            />

            <div className="column-mapping__preview">
              <h4>Data Preview ({table.rows.length} rows)</h4>
              <div className="column-mapping__preview-table-wrapper">
                <table className="sas-table sas-table--compact column-mapping__preview-table">
                  <thead className="sas-table__head">
                    <tr>
                      <th className="sas-table__th">#</th>
                      {table.headers.map(header => (
                        <th className="sas-table__th" key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 5).map((row, index) => (
                      <tr className="sas-table__row" key={index}>
                        <td className="sas-table__td">{index + 1}</td>
                        {row.map((cell, cellIndex) => (
                          <td className="sas-table__td" key={cellIndex}>{formatCell(cell)}</td>
                        ))}
                      </tr>
                    ))}
                    {table.rows.length > 5 && (
                      <tr className="column-mapping__preview-more">
                        <td className="sas-table__td" colSpan={table.headers.length + 1}>
                          ... and {table.rows.length - 5} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardBody>

      {table && (
        <CardFooter>
          <div className="batch-run__controls">
            <div className="batch-run__concurrency">
              <label htmlFor="concurrency-input" className="batch-run__label">
                Parallel Requests:
              </label>
              <input
                id="concurrency-input"
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
                aria-describedby="concurrency-tooltip"
              />
              {/* A real button so the explanation is reachable by keyboard (shown on focus) */}
              <button
                type="button"
                className="batch-run__info"
                aria-label="About parallel requests"
                aria-describedby="concurrency-tooltip"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span className="batch-run__tooltip" id="concurrency-tooltip" role="tooltip">
                  <strong>1</strong> = Sequential (one at a time)<br />
                  <strong>Higher values</strong> = Parallel requests (faster, but may overwhelm the server)
                </span>
              </button>
            </div>
            <Button
              variant="primary"
              size="large"
              onClick={handleRunAll}
              disabled={!summary.ready || executing || table.rows.length === 0}
              loading={executing}
            >
              {executing ? 'Executing...' : `Run All (${table.rows.length} rows)`}
            </Button>
          </div>
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
          {report && report.issueCount > 0 && (
            <span className="batch-run__warning" role="status">
              {report.issueCount.toLocaleString()} value{report.issueCount === 1 ? '' : 's'} in{' '}
              {report.issues.length} input{report.issues.length === 1 ? '' : 's'} can&rsquo;t be read and
              will be sent as missing (null), not 0 — see the notes under the mapping.
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  );
};

export default FileUpload;
