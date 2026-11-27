// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * MAS returns a decision DataGrid value as an array of two objects:
 *   [ { metadata: [{ COL_A: 'string' }, { COL_B: 'decimal' }] },
 *     { data: [[cellA1, cellB1], [cellA2, cellB2]] } ]
 * These helpers detect and unpack that shape for display.
 */

export interface ParsedDatagrid {
  headers: string[] | null;
  rows: unknown[][];
}

// Check if a value is a datagrid structure
export const isDatagrid = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  return value.some(
    (item) => typeof item === 'object' && item !== null && 'data' in item
  );
};

// Extract datagrid headers and rows from the value array
export const parseDatagrid = (value: unknown[]): ParsedDatagrid => {
  let headers: string[] | null = null;
  let rows: unknown[][] = [];

  for (const item of value) {
    if (typeof item === 'object' && item !== null) {
      if ('metadata' in item && Array.isArray((item as { metadata: unknown }).metadata)) {
        // metadata is an array of objects like [{ "KEY": "string" }, { "VALUE": "int" }]
        const metadataArray = (item as { metadata: Array<Record<string, string>> }).metadata;
        headers = metadataArray.map((col) => Object.keys(col)[0]);
      }
      if ('data' in item && Array.isArray((item as { data: unknown }).data)) {
        rows = (item as { data: unknown[][] }).data;
      }
    }
  }

  return { headers, rows };
};

// Shape of a datagrid value: row count and column count
export const datagridShape = (value: unknown[]): { rows: number; cols: number } => {
  const { headers, rows } = parseDatagrid(value);
  const firstRow = rows[0];
  const cols = headers?.length ?? (Array.isArray(firstRow) ? firstRow.length : 0);
  return { rows: rows.length, cols };
};

export interface DatagridColumn {
  name: string;
  dataType: string;
}

// Column names with their declared types from the metadata entry
export const parseDatagridColumns = (value: unknown[]): DatagridColumn[] => {
  for (const item of value) {
    if (
      typeof item === 'object' && item !== null &&
      'metadata' in item && Array.isArray((item as { metadata: unknown }).metadata)
    ) {
      const metadataArray = (item as { metadata: Array<Record<string, string>> }).metadata;
      return metadataArray.map((col) => {
        const name = Object.keys(col)[0];
        return { name, dataType: col[name] };
      });
    }
  }
  return [];
};

// Build the native datagrid value array MAS expects as an input value.
// MAS rejects the JSON-string form with a 400 — the value must be real JSON.
export const buildDatagridValue = (columns: DatagridColumn[], rows: unknown[][]): unknown[] => {
  const metadata = columns.map((c) => ({ [c.name]: c.dataType }));
  return [{ metadata }, { data: rows }];
};

// Parse a form value (JSON string or already-parsed array) into a datagrid value array
export const coerceDatagridValue = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return isDatagrid(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) && isDatagrid(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

/** An edited cell's text as the typed value the DataGrid wire format takes. */
export const toTypedCell = (raw: string, dataType: string): unknown => {
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

const isIntType = (t: string) => ['integer', 'int', 'bigint'].includes(t.toLowerCase());
const isNumType = (t: string) => ['decimal', 'double', 'number'].includes(t.toLowerCase());

/**
 * A cell's typed value for an editor that must not change what was entered:
 * text that does not fit a number column is kept as text (and reported by
 * gridCellProblem) instead of becoming 0 or missing.
 */
export const typedCellKeepingText = (raw: string, dataType: string): unknown => {
  const t = raw.trim();
  if (t !== '' && isIntType(dataType) && !/^-?\d+$/.test(t)) return raw;
  if (t !== '' && isNumType(dataType) && Number.isNaN(Number(t))) return raw;
  return toTypedCell(raw, dataType);
};

/** Why a cell does not fit its column's type, or null. */
export const gridCellProblem = (cell: unknown, dataType: string): string | null => {
  if (cell === null || cell === undefined || cell === '') return null;
  if (isIntType(dataType) && !(typeof cell === 'number' && Number.isInteger(cell))) return `${String(cell)} is not a whole number`;
  if (isNumType(dataType) && typeof cell !== 'number') return `${String(cell)} is not a number`;
  return null;
};

/** The first problem cells of a DataGrid value, as "Row 4, testNumber: 0.55 is not a whole number". */
export const gridProblems = (value: unknown, limit = 5): string[] => {
  const grid = coerceDatagridValue(value);
  if (!grid) return [];
  const cols = parseDatagridColumns(grid);
  const { rows } = parseDatagrid(grid);
  const out: string[] = [];
  rows.forEach((r, ri) => cols.forEach((c, ci) => {
    const p = Array.isArray(r) ? gridCellProblem(r[ci], c.dataType) : null;
    if (p && out.length < limit) out.push(`Row ${ri + 1}, ${c.name}: ${p}`);
  }));
  return out;
};
