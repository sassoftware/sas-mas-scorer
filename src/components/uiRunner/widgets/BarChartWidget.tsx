// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { UIField } from '../../../types/uiBuilder';
import { coerceDatagridValue, parseDatagrid } from '../../../utils/datagrid';
import { ReadonlyWidget } from './ReadonlyWidget';
import { TableWidget } from './TableWidget';

/** Bars drawn before the rest are counted (the table view shows them all). */
const MAX_BARS = 50;

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

interface Bar { label: string; value: number }

/** The bars a value gives: an array (one bar per item) or a DataGrid (a label and a value column). */
export function barsFor(field: UIField, value: unknown): Bar[] | null {
  const grid = coerceDatagridValue(value);
  if (grid) {
    const { headers, rows } = parseDatagrid(grid);
    if (rows.length === 0) return [];
    const width = Math.max(headers?.length ?? 0, ...rows.map(r => (Array.isArray(r) ? r.length : 0)));
    const names = headers ?? Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    const find = (name?: string) => (name ? names.findIndex(h => h.toLowerCase() === name.trim().toLowerCase()) : -1);
    const numericCol = (c: number) => rows.every(r => num((r as unknown[])[c]) !== null || (r as unknown[])[c] == null);
    let valueCol = find(field.validation?.chartValueColumn);
    if (valueCol < 0) valueCol = names.findIndex((_h, c) => numericCol(c) && rows.some(r => num((r as unknown[])[c]) !== null));
    if (valueCol < 0) return null;
    let labelCol = find(field.validation?.chartLabelColumn);
    if (labelCol < 0) labelCol = names.findIndex((_h, c) => c !== valueCol && !numericCol(c));
    return rows.flatMap((r, i) => {
      const cells = r as unknown[];
      const v = num(cells[valueCol]);
      if (v === null) return [];
      return [{ label: labelCol >= 0 ? String(cells[labelCol] ?? '') : `Row ${i + 1}`, value: v }];
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => {
      const n = num(v);
      return n === null ? [] : [{ label: String(i + 1), value: n }];
    });
  }
  return null;
}

/**
 * A list or DataGrid result as horizontal bars, each with its label and its
 * value written beside it (so nothing depends on bar length alone), and a
 * button to see the same values as a table.
 */
export const BarChartWidget: React.FC<{ field: UIField; value: unknown; labelId?: string }> = ({ field, value, labelId }) => {
  const [asTable, setAsTable] = useState(false);
  if (value === null || value === undefined) {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }
  let bars = barsFor(field, value);
  if (bars === null) return <ReadonlyWidget field={field} value={value} />;
  if (bars.length === 0) return <span className="ui-runner__readonly ui-runner__readonly--null">No values</span>;

  const sort = field.validation?.chartSort;
  if (sort === 'desc') bars = [...bars].sort((a, b) => b.value - a.value);
  if (sort === 'asc') bars = [...bars].sort((a, b) => a.value - b.value);
  const top = field.validation?.chartTop && field.validation.chartTop > 0 ? field.validation.chartTop : MAX_BARS;
  const shown = bars.slice(0, top);
  const maxAbs = Math.max(...shown.map(b => Math.abs(b.value)), 0) || 1;
  const decimals = field.validation?.decimals;
  const fmt = (n: number) => new Intl.NumberFormat(undefined, decimals !== undefined
    ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
    : { maximumFractionDigits: 4 }).format(n);

  return (
    <div className="ui-runner__chart">
      <button type="button" className="ui-runner__chart-toggle" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}>
        {asTable ? 'Show as chart' : 'Show as table'}
      </button>
      {asTable ? (
        <TableWidget field={field} value={value} labelId={labelId} />
      ) : (
        <>
          <ul className="ui-runner__bars" aria-labelledby={labelId}>
            {shown.map((b, i) => (
              <li key={i} className="ui-runner__bar-row">
                <span className="ui-runner__bar-label" title={b.label}>{b.label}</span>
                <span className="ui-runner__bar-track" aria-hidden="true">
                  <span
                    className={`ui-runner__bar${b.value < 0 ? ' ui-runner__bar--negative' : ''}`}
                    style={{ width: `${(Math.abs(b.value) / maxAbs) * 100}%` }}
                  />
                </span>
                <span className="ui-runner__bar-value">{fmt(b.value)}</span>
              </li>
            ))}
          </ul>
          {bars.length > shown.length && (
            <p className="ui-runner__table-more">Showing {shown.length} of {bars.length} values. The table shows them all.</p>
          )}
        </>
      )}
    </div>
  );
};
