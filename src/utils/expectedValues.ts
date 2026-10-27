// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Expected-versus-actual value comparison for scoring: a loaded scenario's
// expected outputs, a batch file's expected-output columns, and the diff of
// two runs in the run history. The same rules as the segmentation tree's
// table-test comparison (utils/segTree/testRows.ts), widened to the typed
// values MAS returns:
//
//   - numbers compare with a relative tolerance of 1e-9, whether they arrive
//     as numbers or as text ("12.50" equals 12.5);
//   - every kind of missing is the same: null, undefined, NaN, '' and the SAS
//     missing values '.', '.A'–'.Z', '._';
//   - text compares trimmed (SAS pads character values with blanks);
//   - SID's wrapped dates ({ type: 'date', value }) are unwrapped, and a
//     datetime written with 'T' or a blank, with or without a zero fraction
//     or a trailing Z, is one value;
//   - datagrids and other structured values compare element by element with
//     the same rules, also when one side is the JSON text SID or a CSV holds.
//
// An expectation that is null, undefined or blank is "no expectation": it is
// not compared at all (SID stores null for an output a scenario does not
// check, and a blank cell in an expected column means the same).

export type CheckStatus = 'pass' | 'fail' | 'none';

const SAS_MISSING_RE = /^\.[A-Za-z_]?$/;
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?Z?$/;
const NUMBER_TOLERANCE = 1e-9;

/** SID wraps dates and datetimes as { type, value }; the value is what counts. */
export const unwrapValue = (value: unknown): unknown => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if ('type' in v && 'value' in v && Object.keys(v).length === 2) return v.value;
  }
  return value;
};

/** Null, undefined, NaN, blank text or a SAS missing value. */
export const isMissingValue = (value: unknown): boolean => {
  const v = unwrapValue(value);
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || SAS_MISSING_RE.test(t);
  }
  return false;
};

/** Whether an expected value asks for a check (null and blank do not). */
export const hasExpectation = (expected: unknown): boolean => {
  const v = unwrapValue(expected);
  if (v === null || v === undefined) return false;
  return !(typeof v === 'string' && v.trim() === '');
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    return NUMBER_RE.test(t) ? Number(t) : null;
  }
  return null;
};

const normText = (s: string): string => {
  const t = s.trim();
  const m = DATETIME_RE.exec(t);
  if (!m) return t;
  // A zero fraction is no information; any other fraction is kept
  const fraction = m[3] && /[1-9]/.test(m[3]) ? m[3].replace(/0+$/, '') : '';
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  return `${m[1]}T${time}${fraction}`;
};

// A string that holds a JSON array or object (a datagrid saved by SID, a cell
// of the app's own results CSV) is compared as the structure it holds.
const parseStructured = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!(t.startsWith('[') || t.startsWith('{'))) return value;
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether two values are the same under the rules above. Symmetric, so it
 * serves both expected-vs-actual and run-vs-run.
 */
export const valuesEqual = (left: unknown, right: unknown): boolean => {
  const a = unwrapValue(left);
  const b = unwrapValue(right);
  const aMissing = isMissingValue(a);
  const bMissing = isMissingValue(b);
  if (aMissing || bMissing) return aMissing && bMissing;

  if (typeof a === 'object' || typeof b === 'object') {
    const sa = parseStructured(a);
    const sb = parseStructured(b);
    if (Array.isArray(sa) && Array.isArray(sb)) {
      return sa.length === sb.length && sa.every((x, i) => valuesEqual(x, sb[i]));
    }
    if (isPlainObject(sa) && isPlainObject(sb)) {
      const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
      for (const k of keys) if (!valuesEqual(sa[k], sb[k])) return false;
      return true;
    }
    return false;
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const asBool = (v: unknown): boolean | null => {
      if (typeof v === 'boolean') return v;
      const n = toNumber(v);
      if (n !== null) return n !== 0;
      if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'true') return true;
        if (t === 'false') return false;
      }
      return null;
    };
    const ba = asBool(a);
    return ba !== null && ba === asBool(b);
  }

  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) {
    return Math.abs(na - nb) <= NUMBER_TOLERANCE * Math.max(1, Math.abs(na));
  }
  return normText(String(a)) === normText(String(b));
};

/** pass / fail, or none when there is no expectation to check. */
export const checkExpected = (expected: unknown, actual: unknown): CheckStatus => {
  if (!hasExpectation(expected)) return 'none';
  return valuesEqual(expected, actual) ? 'pass' : 'fail';
};

/** A value as short text for a table cell or a CSV ('' for missing). */
export const formatCheckValue = (value: unknown): string => {
  const v = unwrapValue(value);
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// --- Outputs of one run against a set of expected values ---

export interface OutputCheck {
  /** The output name as the run returned it (or as expected, when not returned) */
  name: string;
  expected: unknown;
  actual: unknown;
  /** The run returned this output */
  returned: boolean;
  status: CheckStatus;
}

export interface OutputChecks {
  /** Keyed by lower-cased output name */
  byName: Map<string, OutputCheck>;
  passed: number;
  failed: number;
  /** Expected outputs without an expectation (null / blank) */
  unchecked: number;
  /** Outputs with an expectation that the run did not return (also counted in failed) */
  notReturned: OutputCheck[];
}

/**
 * Check a run's outputs against expected values keyed by output name
 * (matched exactly, else ignoring case). Outputs nobody expected anything of
 * are left out.
 */
export const checkOutputs = (
  outputs: { name: string; value: unknown }[] | undefined,
  expected: Record<string, unknown>
): OutputChecks => {
  const actualByLower = new Map<string, { name: string; value: unknown }>();
  for (const o of outputs ?? []) {
    const key = o.name.toLowerCase();
    if (!actualByLower.has(key)) actualByLower.set(key, o);
  }
  const result: OutputChecks = { byName: new Map(), passed: 0, failed: 0, unchecked: 0, notReturned: [] };
  for (const [name, exp] of Object.entries(expected)) {
    const key = name.toLowerCase();
    if (result.byName.has(key)) continue;
    const actual = actualByLower.get(key);
    const status = actual || !hasExpectation(exp)
      ? checkExpected(exp, actual?.value)
      : 'fail';
    const check: OutputCheck = {
      name: actual?.name ?? name,
      expected: exp,
      actual: actual?.value,
      returned: !!actual,
      status,
    };
    result.byName.set(key, check);
    if (status === 'pass') result.passed++;
    else if (status === 'fail') {
      result.failed++;
      if (!actual) result.notReturned.push(check);
    } else result.unchecked++;
  }
  return result;
};

// --- Batch rows ---

/** The check of one batch row, computed once when the row is scored. */
export interface RowCheck {
  /** fail if any expected output differs; none if no output had an expectation */
  status: CheckStatus;
  /** Names of the outputs that had an expectation */
  checked: string[];
  /** Names of the outputs whose value differs from the expectation */
  failed: string[];
}

export const checkRow = (
  outputs: { name: string; value: unknown }[] | undefined,
  expected: Record<string, unknown>
): RowCheck => {
  const checks = checkOutputs(outputs, expected);
  const checked: string[] = [];
  const failed: string[] = [];
  for (const [name, exp] of Object.entries(expected)) {
    const c = checks.byName.get(name.toLowerCase());
    if (!c || !hasExpectation(exp)) continue;
    checked.push(name);
    if (c.status === 'fail') failed.push(name);
  }
  return {
    status: checked.length === 0 ? 'none' : failed.length > 0 ? 'fail' : 'pass',
    checked,
    failed,
  };
};
