// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { buildDatagridValue, coerceDatagridValue, gridCellProblem, gridProblems, parseDatagrid, parseDatagridColumns, typedCellKeepingText } from '../../../utils/datagrid';
import { csvRecords } from '../../../utils/scrInputs';
import { InputWidgetProps } from './types';

/** Rows a grid takes when neither the decision nor the app author set a limit. */
export const DEFAULT_GRID_ROWS = 1000;
/** Rows drawn for editing; the rest are counted (and sent). */
const EDITABLE_ROWS = 100;

const text = (cell: unknown) => (cell === null || cell === undefined ? '' : String(cell));

/**
 * A DataGrid input edited in place: the columns the app author set (usually
 * read from the decision), a row per line with typed cells, Add row and
 * Remove, and Fill from a CSV file with its columns mapped to the grid's.
 * The value is the DataGrid MAS takes: [{metadata}, {data}].
 */
export const DataGridEditorWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, labelId } = props;
  const columns = useMemo(() => field.validation?.gridColumns ?? [], [field.validation?.gridColumns]);
  const maxRows = field.validation?.maxRows && field.validation.maxRows > 0 ? field.validation.maxRows : DEFAULT_GRID_ROWS;

  // The current cells as text, in the field's column order.
  const cells = useMemo<string[][]>(() => {
    const grid = coerceDatagridValue(value);
    if (!grid) return [];
    const have = parseDatagridColumns(grid).map(c => c.name.toLowerCase());
    const { rows } = parseDatagrid(grid);
    return rows.map(r => columns.map(c => {
      const i = have.indexOf(c.name.toLowerCase());
      return i >= 0 && Array.isArray(r) ? text(r[i]) : '';
    }));
  }, [value, columns]);

  const [csv, setCsv] = useState<{ name: string; headers: string[]; rows: Record<string, string>[]; map: string[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const emit = (next: string[][]) => {
    onChange(next.length === 0 ? null : buildDatagridValue(
      columns.map(c => ({ name: c.name, dataType: c.dataType })),
      next.map(r => r.map((raw, i) => typedCellKeepingText(raw, columns[i]?.dataType ?? 'string')))
    ));
  };

  if (columns.length === 0) {
    return <p className="ui-runner__readonly">This grid has no columns yet. The app author sets them in the builder.</p>;
  }

  const setCell = (r: number, c: number, v: string) => emit(cells.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = () => {
    if (cells.length >= maxRows) { setNote(`This grid takes at most ${maxRows.toLocaleString()} rows.`); return; }
    setNote(null);
    emit([...cells, columns.map(() => '')]);
  };
  const removeRow = (r: number) => { setNote(null); emit(cells.filter((_, i) => i !== r)); };

  const readCsv = async (file: File) => {
    const rows = csvRecords(await file.text());
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const map = columns.map(c => headers.find(h => h.toLowerCase() === c.name.toLowerCase()) ?? '');
    setCsv({ name: file.name, headers, rows, map });
    setNote(rows.length ? null : `${file.name} has no data rows.`);
  };
  const fill = () => {
    if (!csv) return;
    const taken = csv.rows.slice(0, maxRows);
    emit(taken.map(rec => columns.map((_c, i) => (csv.map[i] ? rec[csv.map[i]] ?? '' : ''))));
    setNote(csv.rows.length > maxRows
      ? `Filled ${maxRows.toLocaleString()} of ${csv.rows.length.toLocaleString()} rows: this grid takes at most ${maxRows.toLocaleString()}.`
      : `Filled ${taken.length.toLocaleString()} rows from ${csv.name}.`);
    setCsv(null);
  };

  const inputFor = (r: number, c: number) => {
    const col = columns[c];
    const t = col.dataType.toLowerCase();
    const problem = gridCellProblem(typedCellKeepingText(cells[r][c], col.dataType), col.dataType);
    const common = {
      className: `sas-input ui-runner__grid-input${problem ? ' ui-runner__grid-input--invalid' : ''}`,
      value: cells[r][c],
      disabled,
      'aria-label': `${col.name}, row ${r + 1}`,
      'aria-invalid': problem ? true : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCell(r, c, e.target.value),
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
    if (t === 'integer' || t === 'int' || t === 'bigint' || t === 'decimal' || t === 'double' || t === 'number') {
      return <input type="text" inputMode="decimal" {...common} />;
    }
    if (t === 'date') return <input type="date" {...common} />;
    if (t === 'datetime') return <input type="datetime-local" step="1" {...common} />;
    return <input type="text" {...common} />;
  };

  return (
    <div className="ui-runner__grid">
      <div className="ui-runner__table-wrap" tabIndex={0} role="region" aria-labelledby={labelId}>
        <table className="ui-runner__table ui-runner__grid-table" aria-labelledby={labelId}>
          <thead>
            <tr>
              <th scope="col" className="ui-runner__grid-num">#</th>
              {columns.map(c => <th key={c.name} scope="col">{c.name} <span className="ui-runner__grid-type">{c.dataType}</span></th>)}
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {cells.slice(0, EDITABLE_ROWS).map((_row, r) => (
              <tr key={r}>
                <td className="ui-runner__grid-num">{r + 1}</td>
                {columns.map((_c, c) => <td key={c}>{inputFor(r, c)}</td>)}
                <td>
                  <button type="button" className="sas-button sas-button--tertiary sas-button--small" disabled={disabled} onClick={() => removeRow(r)} aria-label={`Remove row ${r + 1}`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {cells.length === 0 && (
              <tr><td colSpan={columns.length + 2} className="ui-runner__readonly--null">No rows yet.</td></tr>
            )}
          </tbody>
        </table>
        {cells.length > EDITABLE_ROWS && (
          <p className="ui-runner__table-more">Showing {EDITABLE_ROWS} of {cells.length.toLocaleString()} rows for editing; all {cells.length.toLocaleString()} are sent.</p>
        )}
      </div>
      <div className="ui-runner__grid-actions">
        <button type="button" className="sas-button sas-button--secondary sas-button--small" onClick={addRow} disabled={disabled}>Add row</button>
        <label className="sas-button sas-button--secondary sas-button--small ui-runner__grid-file">
          Fill from a CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readCsv(f); e.target.value = ''; }} />
        </label>
        <span className="ui-runner__field-constraint">{cells.length.toLocaleString()} of up to {maxRows.toLocaleString()} rows</span>
      </div>
      {csv && csv.rows.length > 0 && (
        <fieldset className="ui-runner__grid-map">
          <legend>Match the columns of {csv.name} ({csv.rows.length.toLocaleString()} rows)</legend>
          {columns.map((c, i) => (
            <label key={c.name}>
              <span>{c.name}</span>
              <select className="sas-input" value={csv.map[i]} onChange={(e) => setCsv({ ...csv, map: csv.map.map((m, j) => (j === i ? e.target.value : m)) })}>
                <option value="">(leave empty)</option>
                {csv.headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          ))}
          <div className="ui-runner__grid-actions">
            <button type="button" className="sas-button sas-button--primary sas-button--small" onClick={fill}>
              Replace the rows with {Math.min(csv.rows.length, maxRows).toLocaleString()} from the file
            </button>
            <button type="button" className="sas-button sas-button--tertiary sas-button--small" onClick={() => setCsv(null)}>Cancel</button>
          </div>
        </fieldset>
      )}
      {note && <p className="ui-runner__field-constraint" role="status">{note}</p>}
      {gridProblems(value).length > 0 && (
        <ul className="ui-runner__grid-problems" role="alert">
          {gridProblems(value).map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  );
};
