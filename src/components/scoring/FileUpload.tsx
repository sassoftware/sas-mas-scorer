// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, TypeBadge } from '../common/Badge';
import {
  FileFormatAdapter,
  ParsedTable,
  acceptAttribute,
  adapters,
  convertValue,
  findAdapter,
} from '../../utils/fileFormats';

interface FileUploadProps {
  parameters: StepParameter[];
  onExecuteBatch: (rows: Record<string, unknown>[], concurrency: number) => void;
  executing: boolean;
}

interface ColumnMapping {
  [paramName: string]: string | null;
}

const autoMapColumns = (
  headers: string[],
  parameters: StepParameter[]
): ColumnMapping => {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[_\s-]/g, ''));

  parameters.forEach(param => {
    const normalizedParam = param.name.toLowerCase().replace(/[_\s-]/g, '');

    let matchIndex = normalizedHeaders.findIndex(h => h === normalizedParam);

    if (matchIndex === -1) {
      matchIndex = normalizedHeaders.findIndex(h =>
        h.includes(normalizedParam) || normalizedParam.includes(h)
      );
    }

    mapping[param.name] = matchIndex !== -1 ? headers[matchIndex] : null;
  });

  return mapping;
};

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

export const FileUpload: React.FC<FileUploadProps> = ({
  parameters,
  onExecuteBatch,
  executing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [formatLabel, setFormatLabel] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [currentAdapter, setCurrentAdapter] = useState<FileFormatAdapter | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [delimiter, setDelimiter] = useState<string | null>(null);
  const [customDelimiter, setCustomDelimiter] = useState<string>('');

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
      setMapping(autoMapColumns(parsed.headers, parameters));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse file';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [parameters]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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

  const handleMappingChange = useCallback((paramName: string, header: string | null) => {
    setMapping(prev => ({
      ...prev,
      [paramName]: header,
    }));
  }, []);

  const handleClear = useCallback(() => {
    setTable(null);
    setMapping({});
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

  const handleRunAll = useCallback(() => {
    if (!table) return;

    const rows: Record<string, unknown>[] = table.rows.map(row => {
      const rowData: Record<string, unknown> = {};

      parameters.forEach(param => {
        const header = mapping[param.name];
        if (header) {
          const headerIndex = table.headers.indexOf(header);
          if (headerIndex !== -1) {
            rowData[param.name] = convertValue(row[headerIndex], param.type);
          }
        }
      });

      return rowData;
    });

    onExecuteBatch(rows, concurrency);
  }, [table, mapping, parameters, onExecuteBatch, concurrency]);

  const unmappedParams = parameters.filter(p => !mapping[p.name]);
  const allMapped = unmappedParams.length === 0;
  const mappedCount = parameters.length - unmappedParams.length;

  return (
    <Card className="csv-upload">
      <CardHeader>
        <h3>Batch File Upload</h3>
      </CardHeader>
      <CardBody>
        <div className="csv-upload__file-section">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttribute()}
            onChange={handleFileSelect}
            className="csv-upload__file-input"
            id="file-upload-input"
          />
          <label htmlFor="file-upload-input" className="csv-upload__file-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>{fileName || 'Choose file...'}</span>
          </label>
          {formatLabel && <Badge variant="info">{formatLabel}</Badge>}
          {fileName && (
            <Button variant="tertiary" size="small" onClick={handleClear}>
              Clear
            </Button>
          )}
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
              className="csv-upload__delimiter-input"
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
              className="csv-upload__select"
            >
              {table.sheetNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        {table && (
          <div className="csv-upload__mapping-section">
            <div className="csv-upload__mapping-header">
              <h4>Column Mapping</h4>
              <Badge variant={allMapped ? 'success' : 'warning'}>
                {mappedCount}/{parameters.length} mapped
              </Badge>
            </div>

            <div className="csv-upload__mapping-grid">
              {parameters.map(param => (
                <div key={param.name} className="csv-upload__mapping-row">
                  <div className="csv-upload__param-info">
                    <span className="csv-upload__param-name">{param.name}</span>
                    <TypeBadge type={param.type} />
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="csv-upload__arrow"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <select
                    value={mapping[param.name] || ''}
                    onChange={(e) => handleMappingChange(param.name, e.target.value || null)}
                    className={`csv-upload__select ${mapping[param.name] ? 'csv-upload__select--mapped' : 'csv-upload__select--unmapped'}`}
                  >
                    <option value="">-- Select column --</option>
                    {table.headers.map(header => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="csv-upload__preview">
              <h4>Data Preview ({table.rows.length} rows)</h4>
              <div className="csv-upload__preview-table-wrapper">
                <table className="csv-upload__preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {table.headers.map(header => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{formatCell(cell)}</td>
                        ))}
                      </tr>
                    ))}
                    {table.rows.length > 5 && (
                      <tr className="csv-upload__preview-more">
                        <td colSpan={table.headers.length + 1}>
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
          <div className="csv-upload__run-controls">
            <div className="csv-upload__concurrency">
              <label htmlFor="concurrency-input" className="csv-upload__concurrency-label">
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
                className="csv-upload__concurrency-input"
                disabled={executing}
              />
              <div className="csv-upload__concurrency-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span className="csv-upload__concurrency-tooltip">
                  <strong>1</strong> = Sequential (one at a time)<br />
                  <strong>Higher values</strong> = Parallel requests (faster, but may overwhelm the server)
                </span>
              </div>
            </div>
            <Button
              variant="primary"
              size="large"
              onClick={handleRunAll}
              disabled={!allMapped || executing || table.rows.length === 0}
              loading={executing}
            >
              {executing ? 'Executing...' : `Run All (${table.rows.length} rows)`}
            </Button>
          </div>
          {!allMapped && (
            <span className="csv-upload__warning">
              Please map all input parameters before running
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  );
};

export default FileUpload;
