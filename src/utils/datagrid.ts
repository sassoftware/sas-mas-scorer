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
