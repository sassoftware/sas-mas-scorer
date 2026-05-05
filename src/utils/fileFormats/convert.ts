// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Convert a cell value from a parsed table to the parameter's declared type.
// Handles both strings (from text formats) and already-typed primitives/arrays
// (from Parquet, Excel, JSONL).
export const convertValue = (value: unknown, type: string): unknown => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  switch (type) {
    case 'decimal':
      if (typeof value === 'number') return value;
      return parseFloat(String(value)) || 0;
    case 'integer':
    case 'bigint':
      if (typeof value === 'number') return Math.trunc(value);
      if (typeof value === 'bigint') return Number(value);
      return parseInt(String(value), 10) || 0;
    case 'string':
      return typeof value === 'string' ? value : String(value);
    case 'decimalArray':
      if (Array.isArray(value)) {
        return value.map(v => typeof v === 'number' ? v : parseFloat(String(v)) || 0);
      }
      return String(value).split(';').map(v => parseFloat(v.trim()) || 0);
    case 'integerArray':
    case 'bigintArray':
      if (Array.isArray(value)) {
        return value.map(v => typeof v === 'number' ? Math.trunc(v) : parseInt(String(v), 10) || 0);
      }
      return String(value).split(';').map(v => parseInt(v.trim(), 10) || 0);
    case 'stringArray':
      if (Array.isArray(value)) return value.map(v => String(v));
      return String(value).split(';').map(v => v.trim());
    default:
      return value;
  }
};
