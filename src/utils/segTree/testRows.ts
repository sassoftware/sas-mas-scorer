// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Test records for a segmentation tree: one generated row per path, which the
 * user can edit, extend and delete before they become SID scenarios or one
 * table-based test. The table carries `_pathId` and `expected_<output>`
 * columns; the test is created with variableCarried, so those come through to
 * the output table and each row can be checked against what it expected.
 */

import type { ScoreDefinitionMapping, ScoreDefinitionPayload, TestScoreDefinitionPayload } from '../../api/scoreDefinitions';
import { serializeCsv } from '../csv';
import {
  constraintIsTrivial,
  leafExpectedOutputs,
  type LeafStatus,
  pathConstraints,
  pathNumber,
  sampleValue,
  type TreeIndex,
  type VarType,
} from './treeIndex';

export const PATH_ID_COLUMN = '_pathId';
export const EXPECTED_PREFIX = 'expected_';

export interface TestRow {
  /** Stable React key; also the `_pathId` of a row the user added. */
  key: string;
  /** The leaf this row was generated for; null for a row the user added. */
  leafId: string | null;
  label: string;
  /** Cell text per input variable; '' is missing. */
  inputs: Record<string, string>;
  /** Cell text per output variable; '' is not checked. */
  expected: Record<string, string>;
  status: LeafStatus | 'custom';
  /** Why the row needs attention, when it does. */
  note?: string;
}

export interface TestRowSet {
  inputVariables: string[];
  outputVariables: string[];
  rows: TestRow[];
  /** Leaves left out because no value can reach them. */
  shadowed: string[];
}

const cellText = (v: string | number | boolean | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/** One row per reachable leaf; unreachable (shadowed) leaves are listed, not generated. */
export function buildTestRows(index: TreeIndex, leafIds: string[]): TestRowSet {
  const inputVariables: string[] = [];
  const outputVariables: string[] = [];
  const rows: TestRow[] = [];
  const shadowed: string[] = [];

  for (const leafId of leafIds) {
    const status = index.leafStatus.get(leafId) ?? 'ok';
    if (status === 'shadowed') {
      shadowed.push(leafId);
      continue;
    }
    const inputs: Record<string, string> = {};
    const unresolved: string[] = [];
    for (const c of pathConstraints(index, leafId)) {
      if (constraintIsTrivial(c)) continue;
      if (!inputVariables.includes(c.variable)) inputVariables.push(c.variable);
      const v = sampleValue(c);
      if (v === undefined) unresolved.push(c.variable);
      inputs[c.variable] = cellText(v);
    }
    const expected: Record<string, string> = {};
    for (const o of leafExpectedOutputs(index, leafId)) {
      if (!outputVariables.includes(o.variable)) outputVariables.push(o.variable);
      expected[o.variable] = cellText(o.value);
    }
    rows.push({
      key: leafId,
      leafId,
      label: `Path ${pathNumber(index, leafId)}`,
      inputs,
      expected,
      status,
      note: unresolved.length ? `Enter a value for ${unresolved.join(', ')}` : undefined,
    });
  }
  return { inputVariables, outputVariables, rows, shadowed };
}

let customCounter = 0;

export function emptyCustomRow(): TestRow {
  customCounter += 1;
  return {
    key: `custom-${Date.now().toString(36)}-${customCounter}`,
    leafId: null,
    label: 'Custom row',
    inputs: {},
    expected: {},
    status: 'custom',
  };
}

// ─── Typed values ───

function typedValue(text: string, type: VarType | undefined): string | number | null {
  const t = text.trim();
  if (t === '') return null;
  if (type === 'string') return text;
  const n = Number(t);
  return Number.isFinite(n) ? n : text;
}

function outputType(index: TreeIndex, variable: string): VarType | undefined {
  const known = index.varTypes.get(variable);
  if (known) return known;
  // Outputs missing from the signature: infer from the outcome literals.
  for (const o of index.outcomes.values()) {
    const a = o.actions?.find((x) => x.variableName === variable);
    if (a) return typeof a.value === 'number' ? 'numeric' : 'string';
  }
  return undefined;
}

// ─── Table test ───

/** Input columns that hold at least one value; an all-blank column would import as text. */
export function usedInputColumns(set: TestRowSet, rows: TestRow[]): string[] {
  return set.inputVariables.filter((v) => rows.some((r) => (r.inputs[v] ?? '').trim() !== ''));
}

export function testTableCsv(set: TestRowSet, rows: TestRow[]): string {
  const inputs = usedInputColumns(set, rows);
  const header = [
    ...inputs,
    PATH_ID_COLUMN,
    ...set.outputVariables.map((v) => `${EXPECTED_PREFIX}${v}`),
  ];
  const body = rows.map((r) => [
    ...inputs.map((v) => (r.inputs[v] ?? '').trim()),
    r.key,
    ...set.outputVariables.map((v) => (r.expected[v] ?? '').trim()),
  ]);
  return serializeCsv([header, ...body]);
}

export interface SidTarget {
  serverName: string;
  caslibName: string;
  treeName: string;
  /** /decisions/segmentationTrees/{id}/revisions/{revisionId} */
  treeRevisionUri: string;
}

export function tableTestPayload(
  name: string,
  description: string | undefined,
  inputTableName: string,
  inputColumns: string[],
  target: SidTarget
): TestScoreDefinitionPayload {
  return {
    name,
    description,
    inputData: {
      type: 'CASTable',
      serverName: target.serverName,
      libraryName: target.caslibName,
      tableName: inputTableName,
    },
    properties: {
      outputLibraryName: target.caslibName,
      outputServerName: target.serverName,
      tableBaseName: name,
      test: 'true',
      variableCarried: 'true',
      version: '1.0',
    },
    objectDescriptor: { name: target.treeName, type: 'segmentationTree', uri: target.treeRevisionUri },
    mappings: inputColumns.map((v) => ({ variableName: v, mappingType: 'datasource', mappingValue: v })),
  };
}

export function scenarioPayload(
  name: string,
  description: string | undefined,
  row: TestRow,
  set: TestRowSet,
  index: TreeIndex,
  target: SidTarget
): ScoreDefinitionPayload {
  const mappings: ScoreDefinitionMapping[] = [];
  for (const v of set.inputVariables) {
    const value = typedValue(row.inputs[v] ?? '', index.varTypes.get(v));
    if (value !== null) mappings.push({ variableName: v, mappingType: 'static', mappingValue: value });
  }
  for (const v of set.outputVariables) {
    const value = typedValue(row.expected[v] ?? '', outputType(index, v));
    if (value !== null) mappings.push({ variableName: v, mappingType: 'expected', mappingValue: value });
  }
  return {
    name,
    description,
    inputData: { type: 'Scenario' },
    properties: {
      outputLibraryName: target.caslibName,
      outputServerName: target.serverName,
      tableBaseName: name,
      version: '1.0',
    },
    objectDescriptor: { name: target.treeName, type: 'segmentationTree', uri: target.treeRevisionUri },
    mappings,
  };
}

// ─── Results ───

export interface Mismatch {
  variable: string;
  expected: string;
  actual: string;
}

export interface RowResult {
  pathId: string;
  /** unchecked: the row expected nothing. */
  status: 'pass' | 'fail' | 'unchecked';
  mismatches: Mismatch[];
  actual: Record<string, string>;
}

export interface TestRunResults {
  byPath: Map<string, RowResult>;
  passed: number;
  failed: number;
  unchecked: number;
  /** Output rows whose `_pathId` matched no test row. */
  unmatched: number;
}

const isMissing = (s: string): boolean => s === '' || s === '.';

function sameValue(expected: string, actual: string): boolean {
  const e = expected.trim();
  const a = actual.trim();
  if (isMissing(e) && isMissing(a)) return true;
  const en = Number(e);
  const an = Number(a);
  if (e !== '' && a !== '' && Number.isFinite(en) && Number.isFinite(an)) {
    return Math.abs(en - an) <= 1e-9 * Math.max(1, Math.abs(en));
  }
  return e === a;
}

/** Compare a test's output table (columns + rows from rowSets) with the rows' expectations. */
export function compareResults(
  columns: string[],
  rows: unknown[][],
  outputVariables: string[]
): TestRunResults {
  const lower = columns.map((c) => c.toLowerCase());
  const col = (name: string) => lower.indexOf(name.toLowerCase());
  const pathCol = col(PATH_ID_COLUMN);
  const results: TestRunResults = { byPath: new Map(), passed: 0, failed: 0, unchecked: 0, unmatched: 0 };
  if (pathCol < 0) return results;

  for (const row of rows) {
    const cell = (i: number) => (i >= 0 ? String(row[i] ?? '') : '');
    const pathId = cell(pathCol).trim();
    if (!pathId) {
      results.unmatched += 1;
      continue;
    }
    const actual: Record<string, string> = {};
    const mismatches: Mismatch[] = [];
    let checked = 0;
    for (const v of outputVariables) {
      const a = cell(col(v));
      actual[v] = a;
      const e = cell(col(`${EXPECTED_PREFIX}${v}`));
      if (e.trim() === '') continue;
      checked += 1;
      if (!sameValue(e, a)) mismatches.push({ variable: v, expected: e, actual: a });
    }
    const status = checked === 0 ? 'unchecked' : mismatches.length ? 'fail' : 'pass';
    results.byPath.set(pathId, { pathId, status, mismatches, actual });
    results[status === 'pass' ? 'passed' : status === 'fail' ? 'failed' : 'unchecked'] += 1;
  }
  return results;
}

/**
 * The output variables a test checks, read back from its output table: every
 * `expected_<name>` column. Used for a test this page did not just create
 * (re-run, or the last results of a saved test).
 */
export function expectedVariables(columns: string[]): string[] {
  const prefix = EXPECTED_PREFIX.toLowerCase();
  return columns
    .filter((c) => c.toLowerCase().startsWith(prefix) && c.length > prefix.length)
    .map((c) => c.slice(prefix.length));
}

/** True for the `_pathId` of a row the user added in the test dialog (not a path). */
export const isCustomRowId = (pathId: string): boolean => pathId.startsWith('custom-');

/**
 * Result rows whose `_pathId` is not a path of this tree revision: the path
 * was removed, or gained a split below it, since the test was made. Rows the
 * user added are not paths to begin with and are left out.
 */
export function stalePathIds(index: TreeIndex, results: TestRunResults): string[] {
  const stale: string[] = [];
  for (const id of results.byPath.keys()) {
    if (isCustomRowId(id)) continue;
    const b = index.branches.get(id);
    if (!b || b.childSplitId) stale.push(id);
  }
  return stale;
}

/** A CAS-safe table name derived from a test name. */
export function casTableName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
  return cleaned.slice(0, 100) || 'SEGTREE_TEST';
}
