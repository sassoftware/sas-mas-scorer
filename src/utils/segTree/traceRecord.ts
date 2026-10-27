// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Predict which path a record takes, from the tree's own branch conditions.
 * This is not SAS: it does not run or imitate the DS2 that SAS Intelligent
 * Decisioning generates. It decides a step only when the step uses the
 * condition kinds conditions.ts parses completely, and stops with a reason
 * at anything else rather than guess.
 *
 * Decided:
 * - first-match order: branches are tried in order, the first that holds wins;
 * - Other: takes whatever reaches it, missing included;
 * - numeric value-list keys `a<=v<b`, `v>=a`, `v<b`, `v=a`, a plain number;
 *   a JSON null is missing, which sorts below every number (so `v<b` holds
 *   for it and `a<=v<b` does not), as conditions.ts models it;
 * - character literals, compared exactly; a JSON null or '' is missing (blank).
 *
 * Refused (the walk stops at the step and says why):
 * - a split that is not on one variable (boolean expression), or a branch
 *   whose condition the parser left unstructured;
 * - a variable that is not in the tree's signature (a custom function, a
 *   derived value) or that the record does not carry;
 * - a value whose JSON type does not match the variable (text for a number,
 *   a number for text, booleans, objects) — nothing is converted;
 * - a special missing value (`.`, `.A`–`.Z`, `._` given as text);
 * - a non-integer value for an integer variable;
 * - a number within rounding distance of a cut point, but not equal to it;
 * - a character value that differs from a branch literal only in case or in
 *   leading or trailing blanks, a value with leading or trailing blanks, a
 *   blank literal, and a literal that looks like a list or an expression
 *   (comma, quote, comparison operator), since the parser keeps those as one
 *   literal.
 */

import type { NumSet } from './conditions';
import type { TreeIndex, VarType } from './treeIndex';

/** A variable's value as the walk sees it. */
export type TraceValue =
  | { kind: 'missing' }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

/** One branch the walk tried, in test order: the ones it passed over, then the one it took. */
export interface TriedBranch {
  branchId: string;
  label: string;
  matched: boolean;
}

export interface TraceStep {
  splitId: string;
  variable: string;
  /** The value tested; null when the walk stopped before reading one. */
  value: TraceValue | null;
  /** The branch taken; null when the walk stopped at this split. */
  branchId: string | null;
  tried: TriedBranch[];
}

export type TraceStopReason =
  /** A boolean-expression split, or a branch condition the parser did not structure. */
  | { kind: 'expression'; branchId: string | null; label: string }
  /** The split tests a name that is not an input of the tree's signature. */
  | { kind: 'notInSignature'; variable: string }
  /** The record does not carry the variable. */
  | { kind: 'absent'; variable: string }
  /** The record's value has a different type than the variable. */
  | { kind: 'typeMismatch'; variable: string; detail: string }
  /** A comparison whose SAS result this page cannot be sure of. */
  | { kind: 'uncertain'; variable: string; branchId: string | null; detail: string }
  /** No branch matched and the split has no Other branch: the record leaves the tree without an outcome. */
  | { kind: 'noBranch'; variable: string };

export interface TraceResult {
  /** leaf: every step was decided and a path reached. stopped: see `stop`. */
  status: 'leaf' | 'stopped';
  steps: TraceStep[];
  /** The leaf reached, when status is leaf. */
  leafId: string | null;
  /** The deepest branch reached; null when the walk stopped at the root split. */
  lastBranchId: string | null;
  stop: TraceStopReason | null;
  /** Assumptions the walk made that the user asked for (absent variables taken as missing). */
  notes: string[];
}

export interface TraceOptions {
  /** Treat variables the record does not carry as missing instead of stopping (default false). */
  absentAsMissing?: boolean;
}

const SPECIAL_MISSING = /^\s*\.[A-Za-z_]?\s*$/;
/** A literal that may be a list or an expression the parser kept as one value. */
const UNSTRUCTURED_LITERAL = /[,'"<>=()]|\bv\b/;
const NEAR_REL = 1e-9;

/** The record's keys looked up case-insensitively, as SAS names are. */
function recordLookup(record: Record<string, unknown>): (name: string) => { found: boolean; value: unknown } {
  const byLower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(record)) {
    const lk = k.toLowerCase();
    if (!byLower.has(lk)) byLower.set(lk, v);
  }
  return (name) => {
    if (Object.prototype.hasOwnProperty.call(record, name)) return { found: true, value: record[name] };
    const lk = name.toLowerCase();
    return byLower.has(lk) ? { found: true, value: byLower.get(lk) } : { found: false, value: undefined };
  };
}

type Read = { ok: true; value: TraceValue } | { ok: false; stop: 'typeMismatch' | 'uncertain'; detail: string };

/** A record value as the variable's type, without converting anything. */
export function readValue(raw: unknown, type: VarType): Read {
  if (raw === null || raw === undefined) return { ok: true, value: { kind: 'missing' } };
  if (type === 'string') {
    if (typeof raw !== 'string') return { ok: false, stop: 'typeMismatch', detail: `the ${typeof raw} ${JSON.stringify(raw)} is not a text value` };
    if (raw === '') return { ok: true, value: { kind: 'missing' } };
    if (raw.trim() === '' || raw !== raw.trim()) {
      return { ok: false, stop: 'uncertain', detail: `'${raw}' has leading or trailing blanks, and how SAS pads them in this comparison is not certain` };
    }
    return { ok: true, value: { kind: 'string', value: raw } };
  }
  if (typeof raw === 'string' && SPECIAL_MISSING.test(raw)) {
    return { ok: false, stop: 'uncertain', detail: `"${raw}" is a SAS special missing value; give null for missing` };
  }
  if (typeof raw !== 'number') return { ok: false, stop: 'typeMismatch', detail: `the ${typeof raw} ${JSON.stringify(raw)} is not a JSON number` };
  if (!Number.isFinite(raw)) return { ok: false, stop: 'typeMismatch', detail: `${raw} is not a finite number` };
  if (type === 'integer' && !Number.isInteger(raw)) {
    return { ok: false, stop: 'typeMismatch', detail: `${raw} is not a whole number, and the variable is an integer` };
  }
  return { ok: true, value: { kind: 'number', value: raw } };
}

const near = (a: number, b: number) => a !== b && Math.abs(a - b) <= NEAR_REL * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether a numeric set holds the value; null when the value sits within rounding distance of one of its bounds. */
export function inNumSet(set: NumSet, value: TraceValue): boolean | null {
  if (value.kind === 'missing') return set.missing;
  if (value.kind !== 'number') return null;
  const x = value.value;
  for (const iv of set.intervals) {
    if ((Number.isFinite(iv.lo) && near(x, iv.lo)) || (Number.isFinite(iv.hi) && near(x, iv.hi))) return null;
  }
  return set.intervals.some((iv) =>
    (x > iv.lo || (iv.loInc && x === iv.lo)) && (x < iv.hi || (iv.hiInc && x === iv.hi))
  );
}

/** Whether a character literal equals the value; null when only case or blanks tell them apart, or the literal is not plain. */
export function equalsLiteral(literal: string, value: TraceValue): boolean | null {
  if (literal.trim() === '' || literal !== literal.trim() || UNSTRUCTURED_LITERAL.test(literal)) return null;
  if (value.kind === 'missing') return false;
  if (value.kind !== 'string') return null;
  if (literal === value.value) return true;
  return literal.toLowerCase() === value.value.toLowerCase() ? null : false;
}

export function describeValue(value: TraceValue | null): string {
  if (!value) return '';
  if (value.kind === 'missing') return 'missing';
  if (value.kind === 'number') return String(value.value);
  return `'${value.value}'`;
}

/** Walk `record` through the tree, first match per split, stopping at anything it cannot decide. */
export function traceRecord(index: TreeIndex, record: Record<string, unknown>, options: TraceOptions = {}): TraceResult {
  const lookup = recordLookup(record);
  const steps: TraceStep[] = [];
  const notes: string[] = [];
  let lastBranchId: string | null = null;
  const stopped = (stop: TraceStopReason | null): TraceResult =>
    ({ status: 'stopped', steps, leafId: null, lastBranchId, stop, notes });

  let splitId = index.rootSplitId;
  // A path cannot visit more splits than the tree has; the guard only protects against a malformed index.
  for (let guard = 0; splitId && guard <= index.splits.size; guard++) {
    const split = index.splits.get(splitId);
    if (!split) break;
    const step: TraceStep = { splitId, variable: split.variable, value: null, branchId: null, tried: [] };
    steps.push(step);
    const branches = split.branchIds.map((id) => index.branches.get(id)!);
    const onlyOther = branches.length > 0 && branches[0].condition.kind === 'other';

    let value: TraceValue | null = null;
    if (!onlyOther) {
      if (!split.isVariable) return stopped({ kind: 'expression', branchId: null, label: split.variable });
      const type = index.varTypes.get(split.variable);
      if (!type) return stopped({ kind: 'notInSignature', variable: split.variable });
      const { found, value: raw } = lookup(split.variable);
      if (!found && !options.absentAsMissing) return stopped({ kind: 'absent', variable: split.variable });
      if (!found) notes.push(`${split.variable} is not in the record and was taken as missing, as you chose.`);
      const read = readValue(found ? raw : null, type);
      if (!read.ok) {
        return stopped(read.stop === 'typeMismatch'
          ? { kind: 'typeMismatch', variable: split.variable, detail: read.detail }
          : { kind: 'uncertain', variable: split.variable, branchId: null, detail: read.detail });
      }
      value = read.value;
      step.value = value;
    }

    let taken: string | null = null;
    for (const b of branches) {
      const c = b.condition;
      let matches: boolean | null;
      if (c.kind === 'other') matches = true;
      else if (c.kind === 'opaque' || !value) return stopped({ kind: 'expression', branchId: b.id, label: b.label });
      else if (c.kind === 'numeric') {
        if (index.varTypes.get(split.variable) === 'string') return stopped({ kind: 'expression', branchId: b.id, label: b.label });
        matches = inNumSet(c.set, value);
        if (matches === null) {
          return stopped({ kind: 'uncertain', variable: split.variable, branchId: b.id, detail: `${describeValue(value)} is within rounding distance of a cut point of "${b.label}"` });
        }
      } else {
        // Branch conditions are single literals; anything else was not parsed from a branch.
        const literal = c.set.include?.length === 1 && c.set.exclude.length === 0 ? c.set.include[0] : null;
        if (literal === null || index.varTypes.get(split.variable) !== 'string') {
          return stopped({ kind: 'expression', branchId: b.id, label: b.label });
        }
        matches = equalsLiteral(literal, value);
        if (matches === null) {
          return stopped({
            kind: 'uncertain',
            variable: split.variable,
            branchId: b.id,
            detail: value.kind === 'string' && literal.toLowerCase() === value.value.toLowerCase()
              ? `${describeValue(value)} and '${literal}' differ only in case`
              : `the branch value '${literal}' may be a list or an expression, or has blanks that SAS may treat differently`,
          });
        }
      }
      step.tried.push({ branchId: b.id, label: b.label, matched: matches });
      if (matches) {
        taken = b.id;
        break;
      }
    }

    if (!taken) return stopped({ kind: 'noBranch', variable: split.variable });
    step.branchId = taken;
    lastBranchId = taken;
    const branch = index.branches.get(taken)!;
    if (!branch.childSplitId) return { status: 'leaf', steps, leafId: taken, lastBranchId, stop: null, notes };
    splitId = branch.childSplitId;
  }
  return stopped(null);
}

/**
 * Parse the text a user pastes: a JSON object of variable → value. A one-row
 * array (as some tools copy it) is accepted too. Returns an error message
 * instead of a record when the text is not that.
 */
export function parseRecordJson(text: string): Record<string, unknown> | string {
  const trimmed = text.trim();
  if (!trimmed) return 'Paste a JSON object, for example {"Age": 42, "Region": "North"}.';
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return `This is not valid JSON: ${(err as Error).message}`;
  }
  if (Array.isArray(parsed) && parsed.length === 1) parsed = parsed[0];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'The JSON must be one object of variable names and values, for example {"Age": 42}.';
  }
  return parsed as Record<string, unknown>;
}

/** Variables the tree splits on, in the order the index first meets them (depth-first). */
export function testedVariables(index: TreeIndex): string[] {
  const seen = new Set<string>();
  for (const split of index.splits.values()) if (split.isVariable) seen.add(split.variable);
  return [...seen];
}

/** What a stop means, in one sentence for the user. */
export function describeStop(stop: TraceStopReason): string {
  switch (stop.kind) {
    case 'expression':
      return stop.branchId
        ? `The branch "${stop.label}" has a condition this page does not evaluate (an expression, or a value it could not fully read).`
        : `The split "${stop.label}" tests an expression, not one input variable; this page does not evaluate expressions.`;
    case 'notInSignature':
      return `The split tests ${stop.variable}, which is not an input in the tree's signature (it may be a function or a derived value).`;
    case 'absent':
      return `The record has no value for ${stop.variable}. Add it, or choose to take variables that are not in the record as missing.`;
    case 'typeMismatch':
      return `${stop.variable} cannot be compared: ${stop.detail}. Nothing is converted, so give the value with the variable's type.`;
    case 'uncertain':
      return `${stop.variable}: ${stop.detail}. How SAS compares this is not certain, so this page does not decide it.`;
    case 'noBranch':
      return `${stop.variable} matches none of the branches and the split has no Other branch, so the record leaves the tree here without an outcome.`;
    default:
      return '';
  }
}
