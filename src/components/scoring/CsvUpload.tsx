// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useRef } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, TypeBadge } from '../common/Badge';

interface CsvUploadProps {
  parameters: StepParameter[];
  onExecuteBatch: (rows: Record<string, unknown>[], concurrency: number) => void;
  executing: boolean;
}

interface CsvData {
  headers: string[];
  rows: string[][];
}

interface ColumnMapping {
  [paramName: string]: string | null; // paramName -> csvHeader
}

// Simple CSV parser
const parseCsv = (text: string): CsvData => {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);

  return { headers, rows };
};

// Convert string value to appropriate type based on parameter type
const convertValue = (value: string, type: string): unknown => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  switch (type) {
    case 'decimal':
      return parseFloat(value) || 0;
    case 'integer':
    case 'bigint':
      return parseInt(value, 10) || 0;
    case 'string':
      return value;
    case 'decimalArray':
      return value.split(';').map(v => parseFloat(v.trim()) || 0);
    case 'integerArray':
    case 'bigintArray':
      return value.split(';').map(v => parseInt(v.trim(), 10) || 0);
    case 'stringArray':
      return value.split(';').map(v => v.trim());
    default:
      return value;
  }
};

// Auto-match CSV headers to parameters
const autoMapColumns = (
  headers: string[],
  parameters: StepParameter[]
): ColumnMapping => {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[_\s-]/g, ''));

  parameters.forEach(param => {
    const normalizedParam = param.name.toLowerCase().replace(/[_\s-]/g, '');

    // Try exact match first
    let matchIndex = normalizedHeaders.findIndex(h => h === normalizedParam);

    // Try contains match
    if (matchIndex === -1) {
      matchIndex = normalizedHeaders.findIndex(h =>
        h.includes(normalizedParam) || normalizedParam.includes(h)
      );
    }

    mapping[param.name] = matchIndex !== -1 ? headers[matchIndex] : null;
  });

  return mapping;
};

export const CsvUpload: React.FC<CsvUploadProps> = ({
  parameters,
  onExecuteBatch,
  executing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = parseCsv(text);

        if (data.headers.length === 0) {
          setError('CSV file is empty or invalid');
          return;
        }

        setCsvData(data);

        // Auto-map columns
        const autoMapping = autoMapColumns(data.headers, parameters);
        setMapping(autoMapping);
      } catch (err) {
        setError('Failed to parse CSV file');
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  }, [parameters]);

  const handleMappingChange = useCallback((paramName: string, csvHeader: string | null) => {
    setMapping(prev => ({
      ...prev,
      [paramName]: csvHeader,
    }));
  }, []);

  const handleClear = useCallback(() => {
    setCsvData(null);
    setMapping({});
    setFileName(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRunAll = useCallback(() => {
    if (!csvData) return;

    const rows: Record<string, unknown>[] = csvData.rows.map(row => {
      const rowData: Record<string, unknown> = {};

      parameters.forEach(param => {
        const csvHeader = mapping[param.name];
        if (csvHeader) {
          const headerIndex = csvData.headers.indexOf(csvHeader);
          if (headerIndex !== -1) {
            rowData[param.name] = convertValue(row[headerIndex] || '', param.type);
          }
        }
      });

      return rowData;
    });

    onExecuteBatch(rows, concurrency);
  }, [csvData, mapping, parameters, onExecuteBatch, concurrency]);

  // Check if all required parameters are mapped
  const unmappedParams = parameters.filter(p => !mapping[p.name]);
  const allMapped = unmappedParams.length === 0;
  const mappedCount = parameters.length - unmappedParams.length;

  return (
    <Card className="csv-upload">
      <CardHeader>
        <h3>CSV Batch Upload</h3>
      </CardHeader>
      <CardBody>
        {/* File Upload Section */}
        <div className="csv-upload__file-section">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="csv-upload__file-input"
            id="csv-file-input"
          />
          <label htmlFor="csv-file-input" className="csv-upload__file-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>{fileName || 'Choose CSV file...'}</span>
          </label>
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

        {/* Mapping Section */}
        {csvData && (
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
                    {csvData.headers.map(header => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Data Preview */}
            <div className="csv-upload__preview">
              <h4>Data Preview ({csvData.rows.length} rows)</h4>
              <div className="csv-upload__preview-table-wrapper">
                <table className="csv-upload__preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {csvData.headers.map(header => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvData.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                    {csvData.rows.length > 5 && (
                      <tr className="csv-upload__preview-more">
                        <td colSpan={csvData.headers.length + 1}>
                          ... and {csvData.rows.length - 5} more rows
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

      {csvData && (
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
              disabled={!allMapped || executing || csvData.rows.length === 0}
              loading={executing}
            >
              {executing ? 'Executing...' : `Run All (${csvData.rows.length} rows)`}
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

export default CsvUpload;
