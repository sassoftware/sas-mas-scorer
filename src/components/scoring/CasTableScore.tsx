// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { StepParameter } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge, TypeBadge } from '../common/Badge';
import {
  getCasServers,
  getCaslibs,
  getCasTables,
  getTableColumns,
  getTableRows,
  CasServer,
  CasLib,
  CasTableInfo,
  CasColumnInfo,
} from '../../api/cas';

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

const DEFAULT_ROW_LIMIT = 1000;

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

export const CasTableScore: React.FC<CasTableScoreProps> = ({
  parameters,
  onExecuteBatch,
  executing,
  onSaveAsTest,
}) => {
  // Browse state
  const [servers, setServers] = useState<CasServer[]>([]);
  const [caslibs, setCaslibs] = useState<CasLib[]>([]);
  const [tables, setTables] = useState<CasTableInfo[]>([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCaslib, setSelectedCaslib] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [tableFilter, setTableFilter] = useState('');

  // Loading states
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingCaslibs, setLoadingCaslibs] = useState(false);
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

  // Load CAS servers on mount
  useEffect(() => {
    const load = async () => {
      try {
        const serverList = await getCasServers();
        setServers(serverList);
        if (serverList.length > 0) {
          setSelectedServer(serverList[0].name);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load CAS servers');
      } finally {
        setLoadingServers(false);
      }
    };
    load();
  }, []);

  // Load caslibs when server changes
  useEffect(() => {
    if (!selectedServer) {
      setCaslibs([]);
      return;
    }

    const load = async () => {
      setLoadingCaslibs(true);
      setSelectedCaslib('');
      setSelectedTable('');
      setTables([]);
      setColumns([]);
      setPreviewRows([]);
      setError(null);
      try {
        const caslibList = await getCaslibs(selectedServer);
        setCaslibs(caslibList);
        if (caslibList.length > 0) {
          const publicLib = caslibList.find(c => c.name.toLowerCase() === 'public');
          setSelectedCaslib(publicLib?.name ?? caslibList[0].name);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load caslibs');
      } finally {
        setLoadingCaslibs(false);
      }
    };
    load();
  }, [selectedServer]);

  // Load tables when caslib changes
  useEffect(() => {
    if (!selectedServer || !selectedCaslib) {
      setTables([]);
      return;
    }

    const load = async () => {
      setLoadingTables(true);
      setSelectedTable('');
      setColumns([]);
      setPreviewRows([]);
      setError(null);
      try {
        const result = await getCasTables(selectedServer, selectedCaslib, 0, 500);
        setTables(result.items.filter(t => (t.rowCount ?? 0) > 0));
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message ?? 'Failed to load tables');
      } finally {
        setLoadingTables(false);
      }
    };
    load();
  }, [selectedServer, selectedCaslib]);

  // Load column metadata and preview rows when table is selected
  const handleSelectTable = useCallback(async (tableName: string) => {
    setSelectedTable(tableName);
    setColumns([]);
    setPreviewRows([]);
    setMapping({});
    setError(null);

    if (!tableName) return;

    // Get row count from the table info we already have
    const tableInfo = tables.find(t => t.name === tableName);
    setTotalRowCount(tableInfo?.rowCount ?? 0);

    setLoadingRows(true);
    try {
      // Fetch column metadata via dataTables endpoint
      const cols = await getTableColumns(selectedServer, selectedCaslib, tableName);
      setColumns(cols);

      // Auto-map columns to parameters
      const colNames = cols.map(c => c.name);
      const autoMapping = autoMapColumns(colNames, parameters);
      setMapping(autoMapping);

      // Fetch a small row preview (best-effort — don't fail if this errors)
      try {
        const preview = await getTableRows(selectedServer, selectedCaslib, tableName, 0, 5);
        setPreviewRows(preview.rows);
        if (preview.count > 0) {
          setTotalRowCount(preview.count);
        }
      } catch (previewErr: unknown) {
        const pe = previewErr as { message?: string };
        console.warn('Row preview failed:', pe.message);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load table data');
    } finally {
      setLoadingRows(false);
    }
  }, [selectedServer, selectedCaslib, parameters, tables]);

  const handleMappingChange = useCallback((paramName: string, colName: string | null) => {
    setMapping(prev => ({ ...prev, [paramName]: colName }));
  }, []);

  // Extract a cell value from a row, handling both array and object row formats
  const getCellValue = useCallback((row: unknown, colName: string, colIndex: number): unknown => {
    if (Array.isArray(row)) {
      return row[colIndex];
    }
    if (row && typeof row === 'object') {
      return (row as Record<string, unknown>)[colName];
    }
    return undefined;
  }, []);

  const [fetchingForScore, setFetchingForScore] = useState(false);

  const handleRunAll = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;

    setError(null);
    setFetchingForScore(true);

    try {
      const effectiveLimit = scoreFullTable ? totalRowCount : Math.min(rowLimit, totalRowCount);
      const result = await getTableRows(selectedServer, selectedCaslib, selectedTable, 0, effectiveLimit);

      if (result.rows.length === 0) {
        setError('No rows returned from the table');
        setFetchingForScore(false);
        return;
      }

      const colNames = columns.map(c => c.name);

      const rows: Record<string, unknown>[] = result.rows.map(row => {
        const rowData: Record<string, unknown> = {};
        parameters.forEach(param => {
          const colName = mapping[param.name];
          if (colName) {
            const colIndex = colNames.indexOf(colName);
            if (colIndex !== -1) {
              rowData[param.name] = convertValue(getCellValue(row, colName, colIndex), param.type);
            }
          }
        });
        return rowData;
      });

      setFetchingForScore(false);
      onExecuteBatch(rows, concurrency);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to fetch table rows');
      setFetchingForScore(false);
    }
  }, [selectedServer, selectedCaslib, selectedTable, scoreFullTable, totalRowCount, columns, mapping, parameters, concurrency, onExecuteBatch, getCellValue]);

  const unmappedParams = parameters.filter(p => !mapping[p.name]);
  const allMapped = unmappedParams.length === 0;
  const mappedCount = parameters.length - unmappedParams.length;

  const filteredTables = tableFilter
    ? tables.filter(t => t.name.toLowerCase().includes(tableFilter.toLowerCase()))
    : tables;

  const effectiveRowCount = scoreFullTable ? totalRowCount : Math.min(rowLimit, totalRowCount);

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
              <label className="cas-table-score__label">CAS Server</label>
              {loadingServers ? (
                <span className="cas-table-score__loading-text">Loading servers...</span>
              ) : (
                <select
                  className="cas-table-score__select"
                  value={selectedServer}
                  onChange={e => setSelectedServer(e.target.value)}
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
              <label className="cas-table-score__label">Caslib</label>
              {loadingCaslibs ? (
                <span className="cas-table-score__loading-text">Loading caslibs...</span>
              ) : (
                <select
                  className="cas-table-score__select"
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
                <label className="cas-table-score__label">
                  Tables {!loadingTables && `(${filteredTables.length})`}
                </label>
                <input
                  type="text"
                  className="cas-table-score__filter"
                  placeholder="Filter tables..."
                  value={tableFilter}
                  onChange={e => setTableFilter(e.target.value)}
                  disabled={executing || loadingTables}
                />
              </div>
              {loadingTables ? (
                <span className="cas-table-score__loading-text">Loading tables...</span>
              ) : filteredTables.length === 0 ? (
                <span className="cas-table-score__empty">
                  {tableFilter ? 'No tables match filter' : 'No tables in this caslib'}
                </span>
              ) : (
                <div className="cas-table-score__table-grid">
                  {filteredTables.map(t => (
                    <button
                      key={t.name}
                      className={`cas-table-score__table-item ${selectedTable === t.name ? 'cas-table-score__table-item--selected' : ''}`}
                      onClick={() => handleSelectTable(t.name)}
                      disabled={executing}
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

        {/* Loading rows indicator */}
        {loadingRows && (
          <div className="cas-table-score__loading-text">Loading table data...</div>
        )}

        {/* Column Mapping (shown after table selection) */}
        {columns.length > 0 && !loadingRows && (
          <div className="cas-table-score__mapping-section">
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
            <div className="csv-upload__preview">
              <h4>Data Preview ({totalRowCount.toLocaleString()} rows in table)</h4>
              {previewRows.length > 0 ? (
                <div className="csv-upload__preview-table-wrapper">
                  <table className="csv-upload__preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        {columns.map(col => (
                          <th key={col.name}>{col.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 5).map((row, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          {columns.map((col, colIndex) => {
                            const cell = getCellValue(row, col.name, colIndex);
                            return (
                              <td key={col.name}>{cell != null ? String(cell) : ''}</td>
                            );
                          })}
                        </tr>
                      ))}
                      {totalRowCount > 5 && (
                        <tr className="csv-upload__preview-more">
                          <td colSpan={columns.length + 1}>
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
          <div className="csv-upload__run-controls">
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
                  <label htmlFor="cas-row-limit" className="csv-upload__concurrency-label">
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
                    className="csv-upload__concurrency-input"
                    disabled={executing}
                  />
                </div>
              )}
            </div>

            <div className="csv-upload__concurrency">
              <label htmlFor="cas-concurrency-input" className="csv-upload__concurrency-label">
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
                className="csv-upload__concurrency-input"
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
                {executing ? 'Executing...' : fetchingForScore ? 'Fetching rows...' : `Run All (${effectiveRowCount.toLocaleString()} rows)`}
              </Button>
            </div>
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

export default CasTableScore;
