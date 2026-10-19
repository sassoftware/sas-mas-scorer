// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Branch conditions of a segmentation tree, as sets of values.
 *
 * SID generates a split as `if … else if … else if (1=1)` in branch order, so
 * the first branch whose condition matches wins and the Other branch catches
 * whatever is left, missing values included. A path therefore constrains a
 * variable to "this branch's values minus every earlier sibling's values",
 * which is set arithmetic, not an evaluation of the tree. Numeric sets follow
 * SAS semantics: a missing value compares lower than every number, so `v<1`
 * holds for missing and `1<=v<3` does not.
 */

export const OTHER_VALUE = '__&OTHER&__';

// ─── Numeric sets ───

export interface Interval {
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
}

/** A union of disjoint, sorted intervals plus whether missing belongs to it. */
export interface NumSet {
  intervals: Interval[];
  missing: boolean;
}

const FULL_LINE: Interval = { lo: -Infinity, loInc: false, hi: Infinity, hiInc: false };

export const ALL_NUMBERS: NumSet = { intervals: [FULL_LINE], missing: true };

function isEmptyInterval(iv: Interval): boolean {
  if (iv.lo > iv.hi) return true;
  if (iv.lo === iv.hi) return !(iv.loInc && iv.hiInc);
  return false;
}

/** Sort, drop empties and merge overlapping or touching intervals. */
function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((iv) => !isEmptyInterval(iv))
    .sort((a, b) => a.lo - b.lo || Number(b.loInc) - Number(a.loInc));
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && (iv.lo < last.hi || (iv.lo === last.hi && (iv.loInc || last.hiInc)))) {
      if (iv.hi > last.hi) {
        last.hi = iv.hi;
        last.hiInc = iv.hiInc;
      } else if (iv.hi === last.hi) {
        last.hiInc = last.hiInc || iv.hiInc;
      }
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

function intersectInterval(a: Interval, b: Interval): Interval {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  return {
    lo,
    loInc: (a.lo !== lo || a.loInc) && (b.lo !== lo || b.loInc),
    hi,
    hiInc: (a.hi !== hi || a.hiInc) && (b.hi !== hi || b.hiInc),
  };
}

export function intersectNum(a: NumSet, b: NumSet): NumSet {
  const out: Interval[] = [];
  for (const x of a.intervals) {
    for (const y of b.intervals) out.push(intersectInterval(x, y));
  }
  return { intervals: normalize(out), missing: a.missing && b.missing };
}

function complementNum(a: NumSet): NumSet {
  const out: Interval[] = [];
  let lo = -Infinity;
  let loInc = false;
  for (const iv of a.intervals) {
    out.push({ lo, loInc, hi: iv.lo, hiInc: !iv.loInc });
    lo = iv.hi;
    loInc = !iv.hiInc;
  }
  out.push({ lo, loInc, hi: Infinity, hiInc: false });
  return { intervals: normalize(out), missing: !a.missing };
}

export function subtractNum(a: NumSet, b: NumSet): NumSet {
  return intersectNum(a, complementNum(b));
}

export function isEmptyNum(a: NumSet): boolean {
  return a.intervals.length === 0 && !a.missing;
}

function coversLine(a: NumSet): boolean {
  return a.intervals.length === 1 && a.intervals[0].lo === -Infinity && a.intervals[0].hi === Infinity;
}

export function isAllNum(a: NumSet): boolean {
  return a.missing && coversLine(a);
}

function pickInInterval(iv: Interval, integer: boolean): number | null {
  const inside = (x: number) =>
    (x > iv.lo || (iv.loInc && x === iv.lo)) && (x < iv.hi || (iv.hiInc && x === iv.hi));
  const finiteLo = Number.isFinite(iv.lo);
  const finiteHi = Number.isFinite(iv.hi);
  // The lower bound first: the strategy ranges are written as lower bounds,
  // and the boundary is the most telling value to test.
  const candidates: number[] = [];
  if (finiteLo) candidates.push(iv.lo, Math.floor(iv.lo) + 1);
  if (finiteHi) candidates.push(Math.ceil(iv.hi) - 1, iv.hi);
  if (finiteLo && finiteHi) candidates.push((iv.lo + iv.hi) / 2);
  if (!finiteLo && !finiteHi) candidates.push(0);
  for (const c of candidates) {
    if (inside(c) && (!integer || Number.isInteger(c))) return c;
  }
  return null;
}

/**
 * A value inside the set, or null for missing. Returns undefined when the set
 * holds no usable value (empty, or no integer for an integer variable).
 */
export function pickNumber(a: NumSet, integer: boolean): number | null | undefined {
  for (const iv of a.intervals) {
    const v = pickInInterval(iv, integer);
    if (v !== null) return v;
  }
  return a.missing ? null : undefined;
}

// ─── String sets ───

/** `include` null means "any value"; `exclude` removes values from it. */
export interface StrSet {
  include: string[] | null;
  exclude: string[];
}

export const ALL_STRINGS: StrSet = { include: null, exclude: [] };

export function intersectStr(a: StrSet, b: StrSet): StrSet {
  let include: string[] | null;
  if (a.include && b.include) include = a.include.filter((v) => b.include!.includes(v));
  else include = a.include ?? b.include;
  return { include, exclude: [...new Set([...a.exclude, ...b.exclude])] };
}

export function subtractStr(a: StrSet, b: StrSet): StrSet {
  // Removing "any value" leaves nothing; removing a finite list excludes it.
  if (b.include === null) return { include: [], exclude: a.exclude };
  return { include: a.include, exclude: [...new Set([...a.exclude, ...b.include])] };
}

export function allowedStrings(a: StrSet): string[] | null {
  return a.include ? a.include.filter((v) => !a.exclude.includes(v)) : null;
}

export function isEmptyStr(a: StrSet): boolean {
  const allowed = allowedStrings(a);
  return allowed !== null && allowed.length === 0;
}

export function pickString(a: StrSet): string | undefined {
  const allowed = allowedStrings(a);
  if (allowed) return allowed[0];
  let candidate = 'OTHER';
  for (let i = 2; a.exclude.includes(candidate); i++) candidate = `OTHER${i}`;
  return candidate;
}

// ─── Branch conditions ───

export type BranchCondition =
  | { kind: 'numeric'; set: NumSet }
  | { kind: 'string'; set: StrSet }
  | { kind: 'other' }
  /** A condition this module cannot reason about (boolean expressions, unknown syntax). */
  | { kind: 'opaque' };

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const RANGE_RE = new RegExp(`^(${NUM})\\s*(<=|<)\\s*v\\s*(<=|<)\\s*(${NUM})$`);
const BOUND_RE = new RegExp(`^v\\s*(>=|>|<=|<|=)\\s*(${NUM})$`);
const NUMBER_RE = new RegExp(`^${NUM}$`);

/** The numeric set a value-list key or literal describes, or null if it is not numeric. */
export function parseNumericValue(raw: string): NumSet | null {
  const value = raw.trim();
  const range = RANGE_RE.exec(value);
  if (range) {
    return {
      intervals: normalize([{
        lo: Number(range[1]),
        loInc: range[2] === '<=',
        hi: Number(range[4]),
        hiInc: range[3] === '<=',
      }]),
      missing: false,
    };
  }
  const bound = BOUND_RE.exec(value);
  if (bound) {
    const n = Number(bound[2]);
    switch (bound[1]) {
      case '>=': return { intervals: [{ lo: n, loInc: true, hi: Infinity, hiInc: false }], missing: false };
      case '>': return { intervals: [{ lo: n, loInc: false, hi: Infinity, hiInc: false }], missing: false };
      // Missing sorts below every number, so an upper bound alone admits it.
      case '<=': return { intervals: [{ lo: -Infinity, loInc: false, hi: n, hiInc: true }], missing: true };
      case '<': return { intervals: [{ lo: -Infinity, loInc: false, hi: n, hiInc: false }], missing: true };
      default: return { intervals: [{ lo: n, loInc: true, hi: n, hiInc: true }], missing: false };
    }
  }
  if (NUMBER_RE.test(value)) {
    const n = Number(value);
    return { intervals: [{ lo: n, loInc: true, hi: n, hiInc: true }], missing: false };
  }
  return null;
}

/**
 * Parse one branch value. `numeric` is the split variable's type; null when
 * the signature does not say, in which case a value that parses as a number
 * is taken as numeric.
 */
export function parseBranchCondition(raw: string, numeric: boolean | null): BranchCondition {
  if (raw === OTHER_VALUE) return { kind: 'other' };
  if (numeric !== false) {
    const set = parseNumericValue(raw);
    if (set) return { kind: 'numeric', set };
    if (numeric === true) return { kind: 'opaque' };
  }
  return { kind: 'string', set: { include: [raw], exclude: [] } };
}

// ─── Formatting ───

const fmt = (n: number): string => String(n);

/** Human-readable text of a numeric set for variable `name`, e.g. `3 ≤ X < 6 or missing`. */
export function describeNumSet(name: string, a: NumSet): string {
  if (isAllNum(a)) return `${name}: any value`;
  if (coversLine(a)) return `${name} is not missing`;
  const parts = a.intervals.map((iv) => {
    const finiteLo = Number.isFinite(iv.lo);
    const finiteHi = Number.isFinite(iv.hi);
    if (finiteLo && finiteHi && iv.lo === iv.hi) return `${name} = ${fmt(iv.lo)}`;
    if (finiteLo && finiteHi) {
      return `${fmt(iv.lo)} ${iv.loInc ? '≤' : '<'} ${name} ${iv.hiInc ? '≤' : '<'} ${fmt(iv.hi)}`;
    }
    if (finiteLo) return `${name} ${iv.loInc ? '≥' : '>'} ${fmt(iv.lo)}`;
    return `${name} ${iv.hiInc ? '≤' : '<'} ${fmt(iv.hi)}`;
  });
  if (a.missing) parts.push(parts.length ? 'missing' : `${name} is missing`);
  if (parts.length === 0) return `${name}: no value satisfies every condition`;
  return parts.join(' or ');
}

const quoteStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export function describeStrSet(name: string, a: StrSet): string {
  const allowed = allowedStrings(a);
  if (allowed) {
    if (allowed.length === 0) return `${name}: no value satisfies every condition`;
    return allowed.length === 1 ? `${name} = ${quoteStr(allowed[0])}` : `${name} in (${allowed.map(quoteStr).join(', ')})`;
  }
  if (a.exclude.length === 0) return `${name}: any value`;
  return a.exclude.length === 1
    ? `${name} ≠ ${quoteStr(a.exclude[0])}`
    : `${name} not in (${a.exclude.map(quoteStr).join(', ')})`;
}

/** A SAS name, or a name literal when the name is not a valid SAS name. */
export function sasName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) ? name : `'${name.replace(/'/g, "''")}'n`;
}

/** A SAS WHERE / DS2 expression for a numeric set; null when it is unconstrained. */
export function numSetExpression(name: string, a: NumSet): string | null {
  if (isAllNum(a)) return null;
  const v = sasName(name);
  if (coversLine(a)) return `not missing(${v})`;
  if (isEmptyNum(a)) return '0';
  let admitsMissing = false;
  const parts = a.intervals.map((iv) => {
    const finiteLo = Number.isFinite(iv.lo);
    const finiteHi = Number.isFinite(iv.hi);
    if (finiteLo && finiteHi && iv.lo === iv.hi) return `${v} = ${fmt(iv.lo)}`;
    if (finiteLo && finiteHi) {
      return `${fmt(iv.lo)} ${iv.loInc ? '<=' : '<'} ${v} ${iv.hiInc ? '<=' : '<'} ${fmt(iv.hi)}`;
    }
    if (finiteLo) return `${v} ${iv.loInc ? '>=' : '>'} ${fmt(iv.lo)}`;
    // An upper bound alone is also true for missing (SAS semantics).
    admitsMissing = true;
    return `${v} ${iv.hiInc ? '<=' : '<'} ${fmt(iv.hi)}`;
  });
  if (a.missing && !admitsMissing) parts.push(`missing(${v})`);
  let expr = parts.length > 1 ? `(${parts.join(' or ')})` : parts[0];
  if (!a.missing && admitsMissing) expr = `(${expr} and not missing(${v}))`;
  return expr;
}

export function strSetExpression(name: string, a: StrSet): string | null {
  const v = sasName(name);
  const allowed = allowedStrings(a);
  if (allowed) {
    if (allowed.length === 0) return '0';
    return allowed.length === 1 ? `${v} = ${quoteStr(allowed[0])}` : `${v} in (${allowed.map(quoteStr).join(', ')})`;
  }
  if (a.exclude.length === 0) return null;
  return a.exclude.length === 1
    ? `${v} ne ${quoteStr(a.exclude[0])}`
    : `${v} not in (${a.exclude.map(quoteStr).join(', ')})`;
}
