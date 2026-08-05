// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import {
  DatagridColumn,
  buildDatagridValue,
  coerceDatagridValue,
  parseDatagrid,
  parseDatagridColumns,
} from '../../utils/datagrid';

// Schema info resolved from the decision signature for one datagrid parameter.
// columns === null means no dataGridExtension exists → free-form editing.
export interface DataGridParamInfo {
  columns: { name: string; dataType: string; length?: number }[] | null;
  maxRows: number | null;
}

interface DataGridInputModalProps {
  paramName: string;
  schema: DataGridParamInfo;
  value: unknown;
  onApply: (gridValue: unknown[] | null) => void;
  onClose: () => void;
}

const FLEXIBLE_COLUMN_TYPES = ['string', 'decimal', 'integer', 'date', 'datetime', 'boolean'];

const cellToText = (cell: unknown): string =>
  cell === null || cell === undefined ? '' : String(cell);

// Convert an edited cell string back to the typed value for the wire format
const toTypedCell = (raw: string, dataType: string): unknown => {
  if (raw === '') return null;
  const t = dataType.toLowerCase();
  if (t === 'integer' || t === 'int' || t === 'bigint') {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (t === 'decimal' || t === 'double' || t === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  if (t === 'boolean') return raw === 'true';
  // datetime-local inputs omit seconds; SID expects them
  if (t === 'datetime' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
};

export const DataGridInputModal: React.FC<DataGridInputModalProps> = ({
  paramName,
  schema,
  value,
  onApply,
  onClose,
}) => {
  const locked = schema.columns !== null && schema.columns.length > 0;

  // Initialize columns/cells from the schema and any existing value
  const initial = useMemo(() => {
    const existing = coerceDatagridValue(value);
    let columns: DatagridColumn[] = locked
      ? (schema.columns ?? []).map(c => ({ name: c.name, dataType: c.dataType }))
      : [];
    let cells: string[][] = [];

    if (existing) {
      const parsedColumns = parseDatagridColumns(existing);
      if (!locked && parsedColumns.length > 0) {
        columns = parsedColumns;
      }
      const { rows } = parseDatagrid(existing);
      if (locked && parsedColumns.length > 0) {
        // Re-order existing cells into the schema's column order by name
        const indexByName = new Map(parsedColumns.map((c, i) => [c.name.toLowerCase(), i]));
        cells = rows.map(row =>
          columns.map(col => {
            const idx = indexByName.get(col.name.toLowerCase());
            return idx !== undefined && Array.isArray(row) ? cellToText(row[idx]) : '';
          })
        );
      } else {
        cells = rows.map(row =>
          columns.map((_, i) => (Array.isArray(row) ? cellToText(row[i]) : ''))
        );
      }
    }
    // Start with one empty row so the user can type right away
    if (cells.length === 0 && columns.length > 0 && (schema.maxRows === null || schema.maxRows >= 1)) {
      cells = [columns.map(() => '')];
    }
    return { columns, cells };
  }, [value, locked, schema.columns, schema.maxRows]);

  const [columns, setColumns] = useState<DatagridColumn[]>(initial.columns);
  const [cells, setCells] = useState<string[][]>(initial.cells);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleAddRow = () => {
    if (schema.maxRows !== null && cells.length >= schema.maxRows) {
      setNotice(
        `This DataGrid accepts at most ${schema.maxRows} row${schema.maxRows === 1 ? '' : 's'} ` +
        `(dataGridMaxRowCount in the decision signature) — the row was not added.`
      );
      return;
    }
    setNotice(null);
    setCells(prev => [...prev, columns.map(() => '')]);
  };

  const handleRemoveRow = (rowIdx: number) => {
    setNotice(null);
    setCells(prev => prev.filter((_, i) => i !== rowIdx));
  };

  const handleCellChange = (rowIdx: number, colIdx: number, text: string) => {
    setCells(prev => prev.map((row, r) =>
      r === rowIdx ? row.map((cell, c) => (c === colIdx ? text : cell)) : row
    ));
  };

  const handleAddColumn = () => {
    setColumns(prev => [...prev, { name: `column${prev.length + 1}`, dataType: 'string' }]);
    // Adding the first column also seeds the first row
    setCells(prev => (prev.length === 0 ? [['']] : prev.map(row => [...row, ''])));
  };

  const handleRemoveColumn = (colIdx: number) => {
    setColumns(prev => prev.filter((_, i) => i !== colIdx));
    setCells(prev => prev.map(row => row.filter((_, i) => i !== colIdx)));
  };

  const handleColumnNameChange = (colIdx: number, name: string) => {
    setColumns(prev => prev.map((col, i) => (i === colIdx ? { ...col, name } : col)));
  };

  const handleColumnTypeChange = (colIdx: number, dataType: string) => {
    setColumns(prev => prev.map((col, i) => (i === colIdx ? { ...col, dataType } : col)));
  };

  const handleApply = () => {
    if (columns.length === 0) {
      onApply(null);
      return;
    }
    if (!locked) {
      const names = columns.map(c => c.name.trim());
      if (names.some(n => n === '')) {
        setError('Every column needs a name.');
        return;
      }
      const lower = names.map(n => n.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        setError('Column names must be unique.');
        return;
      }
    }
    if (schema.maxRows !== null && cells.length > schema.maxRows) {
      setError(`This DataGrid accepts at most ${schema.maxRows} rows, but the grid has ${cells.length}.`);
      return;
    }
    const typedRows = cells.map(row =>
      row.map((raw, colIdx) => toTypedCell(raw, columns[colIdx]?.dataType ?? 'string'))
    );
    onApply(buildDatagridValue(columns, typedRows));
  };

  const renderCellInput = (rowIdx: number, colIdx: number, raw: string, dataType: string) => {
    const t = dataType.toLowerCase();
    const common = {
      className: 'sas-input datagrid-editor__cell-input',
      value: raw,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        handleCellChange(rowIdx, colIdx, e.target.value),
    };
    if (t === 'boolean') {
      return (
        <select {...common}>
          <option value=""></option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (t === 'integer' || t === 'int' || t === 'bigint') return <input type="number" step="1" {...common} />;
    if (t === 'decimal' || t === 'double' || t === 'number') return <input type="number" step="any" {...common} />;
    if (t === 'date') return <input type="date" {...common} />;
    if (t === 'datetime') return <input type="datetime-local" {...common} />;
    return <input type="text" {...common} />;
  };

  return (
    <div className="cas-upload-overlay" onClick={onClose}>
      <div className="datagrid-modal" onClick={e => e.stopPropagation()}>
        <div className="datagrid-modal__header">
          <div className="datagrid-modal__title">
            <h3>Edit DataGrid — {paramName}</h3>
            {locked && <Badge variant="info">columns from decision signature</Badge>}
            {schema.maxRows !== null && (
              <Badge variant="warning">max {schema.maxRows} rows</Badge>
            )}
          </div>
          <div className="datagrid-modal__actions">
            <button className="cas-upload-dialog__close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="datagrid-modal__body datagrid-modal__body--editor">
          {notice && (
            <Alert variant="warning" dismissible onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          )}
          {error && (
            <Alert variant="error" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {columns.length === 0 ? (
            <p className="datagrid-editor__empty">
              No columns defined yet — add a column to begin building the grid.
            </p>
          ) : (
            <div className="output-display__datagrid-wrapper datagrid-editor__table-wrapper">
              <table className="output-display__datagrid datagrid-editor__table">
                <thead>
                  <tr>
                    <th className="datagrid-editor__row-number">#</th>
                    {columns.map((col, colIdx) => (
                      <th key={colIdx}>
                        {locked ? (
                          <div className="datagrid-editor__column-header">
                            <span>{col.name}</span>
                            <span className="datagrid-editor__column-type">{col.dataType}</span>
                          </div>
                        ) : (
                          <div className="datagrid-editor__column-header">
                            <input
                              type="text"
                              className="sas-input datagrid-editor__column-name"
                              value={col.name}
                              onChange={e => handleColumnNameChange(colIdx, e.target.value)}
                              placeholder="Column name"
                            />
                            <select
                              className="sas-input datagrid-editor__column-select"
                              value={col.dataType}
                              onChange={e => handleColumnTypeChange(colIdx, e.target.value)}
                            >
                              {FLEXIBLE_COLUMN_TYPES.map(t => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                            <button
                              className="datagrid-editor__remove-btn"
                              onClick={() => handleRemoveColumn(colIdx)}
                              title="Remove column"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="datagrid-editor__row-actions" />
                  </tr>
                </thead>
                <tbody>
                  {cells.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="datagrid-editor__row-number">{rowIdx + 1}</td>
                      {columns.map((col, colIdx) => (
                        <td key={colIdx}>
                          {renderCellInput(rowIdx, colIdx, row[colIdx] ?? '', col.dataType)}
                        </td>
                      ))}
                      <td className="datagrid-editor__row-actions">
                        <button
                          className="datagrid-editor__remove-btn"
                          onClick={() => handleRemoveRow(rowIdx)}
                          title="Remove row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cells.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 2} className="output-display__empty">
                        No rows yet — use “Add row” below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="datagrid-editor__toolbar">
            <Button variant="secondary" size="small" onClick={handleAddRow} disabled={columns.length === 0}>
              Add row
            </Button>
            {!locked && (
              <Button variant="secondary" size="small" onClick={handleAddColumn}>
                Add column
              </Button>
            )}
            <span className="datagrid-editor__count">
              {cells.length} row{cells.length === 1 ? '' : 's'}
              {schema.maxRows !== null ? ` of max ${schema.maxRows}` : ''}
            </span>
          </div>

          <div className="datagrid-editor__footer">
            <Button variant="tertiary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleApply}>Apply grid</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataGridInputModal;
