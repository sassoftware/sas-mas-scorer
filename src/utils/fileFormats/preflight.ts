// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Pre-flight for batch scoring: convert every mapped cell once and count, per
// input, the values that cannot be read as the input's type (they are sent as
// missing, not 0) and the Excel/Parquet dates that were turned into SAS
// numbers or ISO text. Shared by the file upload and the CAS table paths.

import { ConvertOptions, DateConversion, convertCell } from './convert';

export interface MappedColumn<R> {
  /** MAS input name */
  name: string;
  /** MAS input type */
  type: string;
  /** Source column name, for messages */
  column: string;
  /** Reads this column's cell from a row */
  read: (row: R) => unknown;
  options?: ConvertOptions;
}

export interface ValueIssue {
  input: string;
  column: string;
  type: string;
  count: number;
  /** Up to MAX_EXAMPLES distinct offending values, as displayed text */
  examples: string[];
  /** 1-based number of the first offending row */
  firstRow: number;
}

export interface DateNote {
  input: string;
  column: string;
  count: number;
  conversion: DateConversion;
}

export interface ConversionReport {
  issues: ValueIssue[];
  dates: DateNote[];
  /** Total unreadable cells across all inputs */
  issueCount: number;
}

const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 40;

const describeValue = (value: unknown): string => {
  let text: string;
  if (value instanceof Date) text = String(value);
  else if (typeof value === 'object' && value !== null) text = JSON.stringify(value);
  // CAS cells arrive padded (' N/A'); the padding is noise in a message
  else text = String(value).trim();
  return text.length > MAX_EXAMPLE_LENGTH ? `${text.slice(0, MAX_EXAMPLE_LENGTH - 1)}…` : text;
};

interface Tally {
  issue: ValueIssue | null;
  dates: Map<DateConversion, number>;
}

const runConversion = <R>(
  rows: R[],
  columns: MappedColumn<R>[],
  emit: ((rowIndex: number, name: string, value: unknown) => void) | null
): ConversionReport => {
  const tallies: Tally[] = columns.map(() => ({ issue: null, dates: new Map() }));

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const raw = col.read(row);
      const result = convertCell(raw, col.type, col.options);
      if (emit) emit(r, col.name, result.value);

      const tally = tallies[c];
      if (result.unparseable) {
        if (!tally.issue) {
          tally.issue = {
            input: col.name,
            column: col.column,
            type: col.type,
            count: 0,
            examples: [],
            firstRow: r + 1,
          };
        }
        tally.issue.count++;
        if (tally.issue.examples.length < MAX_EXAMPLES) {
          const shown = describeValue(raw);
          if (!tally.issue.examples.includes(shown)) tally.issue.examples.push(shown);
        }
      }
      if (result.date) {
        tally.dates.set(result.date, (tally.dates.get(result.date) ?? 0) + 1);
      }
    }
  }

  const issues: ValueIssue[] = [];
  const dates: DateNote[] = [];
  tallies.forEach((tally, c) => {
    if (tally.issue) issues.push(tally.issue);
    tally.dates.forEach((count, conversion) => {
      dates.push({ input: columns[c].name, column: columns[c].column, count, conversion });
    });
  });
  return { issues, dates, issueCount: issues.reduce((sum, i) => sum + i.count, 0) };
};

/** Check the rows without building the converted copy (for a live pre-flight). */
export const scanMappedRows = <R>(rows: R[], columns: MappedColumn<R>[]): ConversionReport =>
  runConversion(rows, columns, null);

/**
 * Convert the rows into MAS input records. `fixed` holds the inputs that do
 * not come from a column (a constant, or null for "send as missing"); they
 * are set on every row.
 */
export const convertMappedRows = <R>(
  rows: R[],
  columns: MappedColumn<R>[],
  fixed: Record<string, unknown> = {}
): { rows: Record<string, unknown>[]; report: ConversionReport } => {
  const out: Record<string, unknown>[] = rows.map(() => ({ ...fixed }));
  const report = runConversion(rows, columns, (r, name, value) => {
    out[r][name] = value;
  });
  return { rows: out, report };
};

/** Human wording of a date conversion, for the pre-flight notes. */
export const describeDateConversion = (conversion: DateConversion): string => {
  switch (conversion) {
    case 'sasDate':
      return 'SAS date values (days since 1 Jan 1960)';
    case 'sasDatetime':
      return 'SAS datetime values (seconds since 1 Jan 1960)';
    case 'isoText':
      return 'ISO 8601 text';
  }
};
