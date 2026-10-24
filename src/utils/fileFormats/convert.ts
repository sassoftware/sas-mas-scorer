// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Convert a cell value from a parsed table (or a CAS rowSet) to the
// parameter's declared type. Handles both strings (text formats, and CAS,
// where every cell arrives as a padded string such as ' 101' or ' .') and
// already-typed values (Parquet, Excel, JSONL: numbers, booleans, Dates,
// arrays).
//
// Missing is null, never 0: an empty cell, a SAS missing value ('.', or a
// special missing '.A'–'.Z', '._') and a NaN all become null. A value that is
// present but cannot be read as the declared type ('N/A', '1,5', '12abc') also
// becomes null, and convertCell reports it as `unparseable` so the caller can
// show it before the run instead of scoring a plausible-looking 0.

export type DateConversion = 'sasDate' | 'sasDatetime' | 'isoText';

export interface ConvertResult {
  value: unknown;
  /** The cell had a value that cannot be read as the declared type; sent as null. */
  unparseable?: boolean;
  /** A JS Date (Excel / Parquet date cell) was converted, and how. */
  date?: DateConversion;
}

export interface ConvertOptions {
  /**
   * The source column is numeric (a CAS double): when it is mapped to a string
   * input, the formatted padding is trimmed and a SAS missing becomes null
   * instead of the text '.'.
   */
  numericSource?: boolean;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SAS_MISSING_RE = /^\.[A-Za-z_]?$/;

// 1960-01-01T00:00:00Z, the SAS date and datetime epoch
const SAS_EPOCH_MS = Date.UTC(1960, 0, 1);
const MS_PER_DAY = 86_400_000;

/** A SAS missing numeric as text: '.', '.A'–'.Z' or '._' (surrounding blanks allowed). */
export const isSasMissingText = (text: string): boolean => SAS_MISSING_RE.test(text.trim());

const isMidnightUtc = (d: Date): boolean =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

// A Date with no time of day is a SAS date (days since 1960), anything else a
// SAS datetime (seconds since 1960). Both readers hand date-only cells over as
// UTC midnight.
const dateToSasNumber = (d: Date): { value: number; date: DateConversion } =>
  isMidnightUtc(d)
    ? { value: Math.round((d.getTime() - SAS_EPOCH_MS) / MS_PER_DAY), date: 'sasDate' }
    : { value: (d.getTime() - SAS_EPOCH_MS) / 1000, date: 'sasDatetime' };

const dateToIsoText = (d: Date): string =>
  isMidnightUtc(d) ? d.toISOString().slice(0, 10) : d.toISOString();

const isInvalidDate = (v: unknown): boolean => v instanceof Date && isNaN(v.getTime());

/** One scalar to a number, or null; `unparseable` when it was present but unreadable. */
const toNumber = (value: unknown, integer: boolean): ConvertResult => {
  const finish = (n: number): number => (integer ? Math.trunc(n) : n);

  if (value === null || value === undefined) return { value: null };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { value: null };
    if (!Number.isFinite(value)) return { value: null, unparseable: true };
    return { value: finish(value) };
  }
  if (typeof value === 'bigint') return { value: Number(value) };
  if (typeof value === 'boolean') return { value: value ? 1 : 0 };
  if (value instanceof Date) {
    if (isInvalidDate(value)) return { value: null, unparseable: true };
    const sas = dateToSasNumber(value);
    return { value: finish(sas.value), date: sas.date };
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '' || SAS_MISSING_RE.test(text)) return { value: null };
    if (NUMBER_RE.test(text)) return { value: finish(Number(text)) };
    return { value: null, unparseable: true };
  }
  return { value: null, unparseable: true };
};

/** One scalar to text, or null. */
const toText = (value: unknown, opts?: ConvertOptions): ConvertResult => {
  if (value === null || value === undefined) return { value: null };
  if (typeof value === 'string') {
    if (opts?.numericSource) {
      const text = value.trim();
      return text === '' || SAS_MISSING_RE.test(text) ? { value: null } : { value: text };
    }
    return { value: value === '' ? null : value };
  }
  if (value instanceof Date) {
    if (isInvalidDate(value)) return { value: null, unparseable: true };
    return { value: dateToIsoText(value), date: 'isoText' };
  }
  if (typeof value === 'number' && Number.isNaN(value)) return { value: null };
  // Nested JSONL / Parquet values (a datagrid column, a struct) keep their
  // structure as JSON text rather than becoming "[object Object]"
  if (typeof value === 'object') return { value: JSON.stringify(value) };
  return { value: String(value) };
};

const toArray = (
  value: unknown,
  convertItem: (item: unknown) => ConvertResult
): ConvertResult => {
  const items = Array.isArray(value) ? value : String(value).split(';');
  let unparseable = false;
  let date: DateConversion | undefined;
  const converted = items.map(item => {
    const r = convertItem(item);
    if (r.unparseable) unparseable = true;
    if (r.date) date = r.date;
    return r.value;
  });
  return { value: converted, ...(unparseable ? { unparseable } : {}), ...(date ? { date } : {}) };
};

/** Convert one cell and say whether it could be read. */
export const convertCell = (value: unknown, type: string, opts?: ConvertOptions): ConvertResult => {
  if (value === null || value === undefined || value === '') return { value: null };
  // A whitespace-only cell is empty for the numeric types; for string inputs
  // blanks are passed through as before (they can be data).
  if (typeof value === 'string' && type !== 'string' && type !== 'stringArray' && value.trim() === '') {
    return { value: null };
  }

  switch (type) {
    case 'decimal':
      return toNumber(value, false);
    case 'integer':
    case 'bigint':
      return toNumber(value, true);
    case 'string':
      return toText(value, opts);
    case 'decimalArray':
      return toArray(value, item => toNumber(item, false));
    case 'integerArray':
    case 'bigintArray':
      return toArray(value, item => toNumber(item, true));
    case 'stringArray':
      if (Array.isArray(value)) return toArray(value, item => toText(item, opts));
      return { value: String(value).split(';').map(v => v.trim()) };
    default:
      return { value };
  }
};

/** Convert one cell; an unreadable value comes back as null (missing). */
export const convertValue = (value: unknown, type: string, opts?: ConvertOptions): unknown =>
  convertCell(value, type, opts).value;
