// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Checks records against an SCR endpoint's signature before they are sent.
 *
 * Each check stands for something the runtime was seen to do (2026-11-04,
 * SCR 1.804 and the Python images), not for a rule assumed from MAS:
 * - SCR ignores input names it does not know and scores them as missing, with
 *   no warning: unknown names are reported here instead.
 * - A string where SCR expects a number fails the request with HTTP 500
 *   ("can't parse argument number"); in batch mode it fails every row.
 * - Python images reject a record without all inputs (HTTP 422).
 * String lengths over the signature's maximum are reported as a warning only:
 * whether the runtime truncates or rejects them was not verified.
 */

import { parseCsv, serializeCsv, stripBom } from './csv';
import type { ScrEndpointInfo, ScrVariable } from '../api/scr';

export interface ScrRowIssue {
  /** 1-based row number; 0 for the single-record form. */
  row: number;
  column?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ScrPreparedRows {
  rows: Record<string, unknown>[];
  issues: ScrRowIssue[];
  /** Columns in the data that the endpoint does not have (SCR would ignore them). */
  unknownColumns: string[];
  /** Inputs the data has no column for (scored as missing, or rejected by Python). */
  missingInputs: string[];
}

const findVariable = (variables: ScrVariable[], name: string): ScrVariable | undefined =>
  variables.find((v) => v.name === name) ??
  variables.find((v) => v.name.toLowerCase() === name.toLowerCase());

/** One value as the endpoint expects it, or an issue. Empty means missing (null). */
function coerce(
  variable: ScrVariable,
  value: unknown
): { value: unknown; error?: string; warning?: string } {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { value: null };
  }
  if (variable.type === 'number') {
    if (typeof value === 'number') return Number.isFinite(value) ? { value } : { value: null, error: 'is not a finite number' };
    const text = String(value).trim();
    const num = Number(text);
    if (!Number.isFinite(num)) return { value: null, error: `"${text}" is not a number` };
    return { value: num };
  }
  const text = String(value);
  if (variable.length !== undefined && text.length > variable.length) {
    return { value: text, warning: `is ${text.length} characters; the signature allows ${variable.length}` };
  }
  return { value: text };
}

/**
 * Turns records keyed by column name into request bodies keyed by the
 * endpoint's input names, collecting every problem found. Rows with an error
 * are still returned (as far as they could be read) so callers decide whether
 * to send.
 */
export function prepareRows(info: ScrEndpointInfo, records: Record<string, unknown>[], firstRow = 1): ScrPreparedRows {
  const columns = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) columns.add(key);

  const unknownColumns = [...columns].filter((c) => !findVariable(info.inputs, c));
  const missingInputs = info.inputs
    .filter((v) => ![...columns].some((c) => c.toLowerCase() === v.name.toLowerCase()))
    .map((v) => v.name);

  const issues: ScrRowIssue[] = [];
  const rows = records.map((record, index) => {
    const rowNumber = firstRow + index;
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(record)) {
      const variable = findVariable(info.inputs, column);
      if (!variable) continue;
      const result = coerce(variable, value);
      out[variable.name] = result.value;
      if (result.error) {
        issues.push({ row: rowNumber, column: variable.name, severity: 'error', message: `${variable.name} ${result.error}` });
      } else if (result.warning) {
        issues.push({ row: rowNumber, column: variable.name, severity: 'warning', message: `${variable.name} ${result.warning}` });
      }
    }
    if (info.inputsRequired) {
      const absent = info.inputs.filter((v) => !(v.name in out)).map((v) => v.name);
      if (absent.length > 0 && missingInputs.length === 0) {
        issues.push({ row: rowNumber, severity: 'error', message: `Missing ${absent.join(', ')}` });
      }
    }
    return out;
  });

  return { rows, issues, unknownColumns, missingInputs };
}

/** CSV text (first line = header) as records keyed by column name. */
export function csvRecords(text: string): Record<string, string>[] {
  const table = parseCsv(stripBom(text)).filter((r) => r.some((cell) => cell.trim() !== ''));
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      if (name) record[name] = cells[index] ?? '';
    });
    return record;
  });
}

/** CSV text for result rows in the given column order. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return serializeCsv([columns, ...rows.map((r) => columns.map((c) => cell(r[c])))]);
}
