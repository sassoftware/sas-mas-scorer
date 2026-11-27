// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';
import { coerceDatagridValue, parseDatagrid } from '../../../utils/datagrid';
import { ReadonlyWidget } from './ReadonlyWidget';

interface Props {
  field: UIField;
  value: unknown;
  /** Id of the field's visible label, which names the table. */
  labelId?: string;
}

/** Rows shown before the rest are counted rather than drawn. */
const MAX_ROWS = 200;

const cellText = (cell: unknown): string => {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') return JSON.stringify(cell);
  return String(cell);
};

/**
 * An output as a table: a decision DataGrid (metadata + data, as MAS returns
 * it, or the same as a JSON string), or a plain array as one column. Anything
 * else falls back to the read-only text, so a value is never hidden.
 */
export const TableWidget: React.FC<Props> = ({ field, value, labelId }) => {
  if (value === null || value === undefined) {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }

  let headers: string[];
  let rows: unknown[][];
  const grid = coerceDatagridValue(value);
  if (grid) {
    const parsed = parseDatagrid(grid);
    rows = parsed.rows;
    const width = Math.max(parsed.headers?.length ?? 0, ...rows.map(r => (Array.isArray(r) ? r.length : 0)));
    headers = parsed.headers ?? Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  } else if (Array.isArray(value)) {
    headers = [field.label];
    rows = value.map(v => [v]);
  } else {
    return <ReadonlyWidget field={field} value={value} />;
  }

  if (rows.length === 0) {
    return <span className="ui-runner__readonly ui-runner__readonly--null">No rows</span>;
  }

  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="ui-runner__table-wrap" tabIndex={0} role="region" aria-labelledby={labelId}>
      <table className="ui-runner__table" aria-labelledby={labelId}>
        <thead>
          <tr>
            {headers.map((h, i) => <th key={i} scope="col">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {headers.map((_, c) => (
                <td key={c}>{cellText(Array.isArray(row) ? row[c] : undefined)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && (
        <p className="ui-runner__table-more">
          Showing {MAX_ROWS} of {rows.length} rows.
        </p>
      )}
    </div>
  );
};
