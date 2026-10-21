// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A flat index over a segmentation tree, built once per load so that every
 * interaction in the explorer is a lookup rather than a walk.
 *
 * Terms: a *split* is a node that tests one variable (SegTreeNode); a
 * *branch* is one of its value nodes (SegTreeValueNode); a *leaf* is a branch
 * with no child split. Leaves are numbered in depth-first order, so the leaves
 * under any branch form one contiguous range [leafStart, leafEnd) — subtree
 * counts and test results become range lookups.
 */

import type {
  SegmentationTreeDetail,
  SegTreeNode,
  SegTreeOutcome,
  SegTreeValueNode,
} from '../../api/segmentationTrees';
import {
  ALL_NUMBERS,
  ALL_STRINGS,
  type BranchCondition,
  describeNumSet,
  describeStrSet,
  intersectNum,
  intersectStr,
  isEmptyNum,
  isEmptyStr,
  isAllNum,
  type NumSet,
  numSetExpression,
  pickNumber,
  pickString,
  parseBranchCondition,
  type StrSet,
  strSetExpression,
  subtractNum,
  subtractStr,
  OTHER_VALUE,
} from './conditions';

export interface SplitInfo {
  id: string;
  /** The variable tested, or the node label for non-variable splits. */
  variable: string;
  /** False for boolean-expression and other non-variable splits. */
  isVariable: boolean;
  parentBranchId: string | null;
  depth: number;
  branchIds: string[];
}

export interface BranchInfo {
  id: string;
  splitId: string;
  /** Position among its siblings; earlier siblings are tested first. */
  index: number;
  label: string;
  value: string;
  isOther: boolean;
  condition: BranchCondition;
  childSplitId: string | null;
  /** Set on leaves; null when the leaf assigns no outcome. */
  outcomeName: string | null;
  overrides: unknown[];
  leafStart: number;
  leafEnd: number;
  /** Distinct outcomes assigned by the leaves below. */
  outcomeCount: number;
}

export type VarType = 'numeric' | 'integer' | 'string';

/** What a path requires of one variable, combining every split on it. */
export interface VarConstraint {
  variable: string;
  type: VarType;
  num: NumSet;
  str: StrSet;
  /** Labels of conditions that could not be interpreted. */
  opaque: string[];
}

export interface PathStep {
  splitId: string;
  branchId: string;
  variable: string;
  label: string;
  isOther: boolean;
}

/**
 * ok: a sample record can be generated. shadowed: no value reaches the branch
 * because earlier siblings already take every value it accepts. manual: a
 * condition could not be interpreted, so the sample needs a person.
 */
export type LeafStatus = 'ok' | 'shadowed' | 'manual';

export interface TreeIndex {
  tree: SegmentationTreeDetail;
  rootSplitId: string | null;
  splits: Map<string, SplitInfo>;
  branches: Map<string, BranchInfo>;
  /** Leaf branch ids in depth-first order. */
  leafIds: string[];
  /** Leaf id → 0-based position in `leafIds`. */
  leafOrdinal: Map<string, number>;
  outcomes: Map<string, SegTreeOutcome>;
  /** Outcome name → its leaves in depth-first order. `''` collects leaves without an outcome. */
  outcomeLeaves: Map<string, string[]>;
  varTypes: Map<string, VarType>;
  /** Variables assigned by any outcome, in first-seen order. */
  outputVariables: string[];
  leafStatus: Map<string, LeafStatus>;
  shadowedCount: number;
  manualCount: number;
}

export const NO_OUTCOME = '';

function typeOf(dataType: string | undefined): VarType {
  const t = (dataType ?? '').toLowerCase();
  if (t === 'string' || t === 'varchar' || t === 'char' || t === 'character') return 'string';
  if (t === 'integer' || t === 'int' || t === 'bigint') return 'integer';
  return 'numeric';
}

export function buildTreeIndex(tree: SegmentationTreeDetail): TreeIndex {
  const varTypes = new Map<string, VarType>();
  for (const v of tree.signature ?? []) varTypes.set(v.name, typeOf(v.dataType));

  const outcomes = new Map<string, SegTreeOutcome>();
  const outputVariables: string[] = [];
  for (const o of tree.outcomes ?? []) {
    outcomes.set(o.name, o);
    for (const a of o.actions ?? []) {
      if (!outputVariables.includes(a.variableName)) outputVariables.push(a.variableName);
    }
  }

  const splits = new Map<string, SplitInfo>();
  const branches = new Map<string, BranchInfo>();
  const leafIds: string[] = [];
  const outcomeLeaves = new Map<string, string[]>();

  // Returns the outcome names below the split, for the per-branch counts.
  const visit = (node: SegTreeNode, parentBranchId: string | null, depth: number): Set<string> => {
    const variable = node.variableName ?? node.label;
    const isVariable = node.type === 'variable';
    const known = varTypes.get(variable);
    const numeric = !isVariable ? null : known === undefined ? null : known !== 'string';
    const split: SplitInfo = { id: node.id, variable, isVariable, parentBranchId, depth, branchIds: [] };
    splits.set(node.id, split);

    const below = new Set<string>();
    node.valueNodes.forEach((vn: SegTreeValueNode, index) => {
      const isOther = vn.value === OTHER_VALUE;
      const branch: BranchInfo = {
        id: vn.id,
        splitId: node.id,
        index,
        label: vn.label || (isOther ? 'Other' : vn.value),
        value: vn.value,
        isOther,
        condition: isVariable ? parseBranchCondition(vn.value, numeric) : isOther ? { kind: 'other' } : { kind: 'opaque' },
        childSplitId: vn.next ? vn.next.id : null,
        outcomeName: vn.next ? null : (vn.outcomeName ?? null),
        overrides: vn.variableAssignmentOutcomeActionOverrides ?? [],
        leafStart: leafIds.length,
        leafEnd: leafIds.length,
        outcomeCount: 0,
      };
      branches.set(vn.id, branch);
      split.branchIds.push(vn.id);

      let names: Set<string>;
      if (vn.next) {
        names = visit(vn.next, vn.id, depth + 1);
      } else {
        leafIds.push(vn.id);
        const key = branch.outcomeName ?? NO_OUTCOME;
        const list = outcomeLeaves.get(key);
        if (list) list.push(vn.id);
        else outcomeLeaves.set(key, [vn.id]);
        names = new Set(branch.outcomeName ? [branch.outcomeName] : []);
      }
      branch.leafEnd = leafIds.length;
      branch.outcomeCount = names.size;
      for (const n of names) below.add(n);
    });
    return below;
  };

  if (tree.node) visit(tree.node, null, 0);

  const leafOrdinal = new Map<string, number>();
  leafIds.forEach((id, i) => leafOrdinal.set(id, i));

  const index: TreeIndex = {
    tree,
    rootSplitId: tree.node?.id ?? null,
    splits,
    branches,
    leafIds,
    leafOrdinal,
    outcomes,
    outcomeLeaves,
    varTypes,
    outputVariables,
    leafStatus: new Map(),
    shadowedCount: 0,
    manualCount: 0,
  };

  for (const id of leafIds) {
    const status = constraintStatus(pathConstraints(index, id));
    index.leafStatus.set(id, status);
    if (status === 'shadowed') index.shadowedCount += 1;
    if (status === 'manual') index.manualCount += 1;
  }
  return index;
}

/** Branch ids from the root down to `branchId`, inclusive. */
export function pathBranchIds(index: TreeIndex, branchId: string): string[] {
  const ids: string[] = [];
  let current: string | null = branchId;
  while (current) {
    ids.unshift(current);
    const branch = index.branches.get(current);
    if (!branch) break;
    current = index.splits.get(branch.splitId)?.parentBranchId ?? null;
  }
  return ids;
}

export function pathSteps(index: TreeIndex, branchId: string): PathStep[] {
  return pathBranchIds(index, branchId).map((id) => {
    const b = index.branches.get(id)!;
    const s = index.splits.get(b.splitId)!;
    return { splitId: s.id, branchId: id, variable: s.variable, label: b.label, isOther: b.isOther };
  });
}

/**
 * What the path to `branchId` requires of each variable, in the order the
 * variables are first tested. A branch accepts its own values minus those of
 * every earlier sibling, since the generated code tests siblings in order.
 */
export function pathConstraints(index: TreeIndex, branchId: string): VarConstraint[] {
  const byVar = new Map<string, VarConstraint>();
  const order: string[] = [];

  for (const id of pathBranchIds(index, branchId)) {
    const branch = index.branches.get(id)!;
    const split = index.splits.get(branch.splitId)!;
    let c = byVar.get(split.variable);
    if (!c) {
      c = {
        variable: split.variable,
        type: index.varTypes.get(split.variable) ?? (branch.condition.kind === 'string' ? 'string' : 'numeric'),
        num: ALL_NUMBERS,
        str: ALL_STRINGS,
        opaque: [],
      };
      byVar.set(split.variable, c);
      order.push(split.variable);
    }

    const own = branch.condition;
    if (own.kind === 'opaque') c.opaque.push(branch.label);
    else if (own.kind === 'numeric') c.num = intersectNum(c.num, own.set);
    else if (own.kind === 'string') c.str = intersectStr(c.str, own.set);

    for (let i = 0; i < branch.index; i++) {
      const sibling = index.branches.get(split.branchIds[i])!.condition;
      if (sibling.kind === 'numeric') c.num = subtractNum(c.num, sibling.set);
      else if (sibling.kind === 'string') c.str = subtractStr(c.str, sibling.set);
      // An earlier Other branch takes everything this one would get.
      else if (sibling.kind === 'other') {
        c.num = { intervals: [], missing: false };
        c.str = { include: [], exclude: [] };
      }
      // An earlier opaque branch may take some of it; only a person can tell.
      else c.opaque.push(`not ${index.branches.get(split.branchIds[i])!.label}`);
    }
  }
  return order.map((v) => byVar.get(v)!);
}

/**
 * Why no record can reach a path, in terms a person can act on.
 *
 * contradiction: the branch at `step` asks for values an earlier split on the
 * same path already sent elsewhere (`earlierSteps`), e.g. `X < 22` then `X ≥ 22`.
 * sibling: the branch's own condition is still possible, but branches above it
 * in the same split (`blockers`) catch every such record first.
 */
export interface UnreachableReason {
  kind: 'contradiction' | 'sibling';
  variable: string;
  /** 1-based position on the path of the branch that can never match. */
  step: number;
  /** 1-based positions of the earlier splits on the same variable. */
  earlierSteps: number[];
  /** What the path still allowed for the variable on reaching `step`. */
  allowed: string;
  /** The label of the branch at `step`. */
  asked: string;
  /** Labels of the earlier sibling branches that take its records. */
  blockers: string[];
  /** The branch at `step`. */
  branchId: string;
}

export function explainUnreachable(index: TreeIndex, leafId: string): UnreachableReason | null {
  const state = new Map<string, { num: NumSet; str: StrSet; steps: number[] }>();
  const ids = pathBranchIds(index, leafId);
  for (let i = 0; i < ids.length; i++) {
    const step = i + 1;
    const branch = index.branches.get(ids[i])!;
    const split = index.splits.get(branch.splitId)!;
    const v = split.variable;
    let s = state.get(v);
    if (!s) {
      s = { num: ALL_NUMBERS, str: ALL_STRINGS, steps: [] };
      state.set(v, s);
    }
    const isString = (index.varTypes.get(v) ?? (branch.condition.kind === 'string' ? 'string' : 'numeric')) === 'string';
    const describe = (num: NumSet, str: StrSet) => (isString ? describeStrSet(v, str) : describeNumSet(v, num));
    const empty = (num: NumSet, str: StrSet) => (isString ? isEmptyStr(str) : isEmptyNum(num));

    // The branch's own condition against what earlier splits let through.
    const own = branch.condition;
    let num = s.num;
    let str = s.str;
    if (own.kind === 'numeric') num = intersectNum(num, own.set);
    else if (own.kind === 'string') str = intersectStr(str, own.set);
    if (own.kind !== 'other' && own.kind !== 'opaque' && empty(num, str) && s.steps.length > 0) {
      return {
        kind: 'contradiction', variable: v, step, earlierSteps: [...s.steps],
        allowed: describe(s.num, s.str), asked: branch.label, blockers: [], branchId: branch.id,
      };
    }

    // What is left once the siblings tested before it have taken their share.
    const blockers: string[] = [];
    let afterNum = num;
    let afterStr = str;
    for (let j = 0; j < branch.index; j++) {
      const sib = index.branches.get(split.branchIds[j])!;
      const c = sib.condition;
      let takes = false;
      if (c.kind === 'numeric') {
        takes = !isEmptyNum(intersectNum(afterNum, c.set));
        afterNum = subtractNum(afterNum, c.set);
      } else if (c.kind === 'string') {
        takes = !isEmptyStr(intersectStr(afterStr, c.set));
        afterStr = subtractStr(afterStr, c.set);
      } else if (c.kind === 'other') {
        takes = true;
        afterNum = { intervals: [], missing: false };
        afterStr = { include: [], exclude: [] };
      }
      if (takes) blockers.push(sib.label);
    }
    if (empty(afterNum, afterStr) && !empty(num, str)) {
      return {
        kind: 'sibling', variable: v, step, earlierSteps: [...s.steps],
        allowed: describe(num, str), asked: branch.label, blockers, branchId: branch.id,
      };
    }
    s.num = afterNum;
    s.str = afterStr;
    s.steps.push(step);
  }
  return null;
}

function constraintEmpty(c: VarConstraint): boolean {
  return c.type === 'string' ? isEmptyStr(c.str) : isEmptyNum(c.num);
}

export function constraintStatus(constraints: VarConstraint[]): LeafStatus {
  if (constraints.some(constraintEmpty)) return 'shadowed';
  if (constraints.some((c) => c.opaque.length > 0)) return 'manual';
  return 'ok';
}

/** One line per variable, e.g. `3 ≤ SCScore01Risk < 6`. */
export function describeConstraint(c: VarConstraint): string {
  const base = c.type === 'string' ? describeStrSet(c.variable, c.str) : describeNumSet(c.variable, c.num);
  return c.opaque.length ? `${base} (also: ${c.opaque.join('; ')})` : base;
}

/** True when the path does not actually narrow the variable (an Other that takes everything). */
export function constraintIsTrivial(c: VarConstraint): boolean {
  if (c.opaque.length) return false;
  return c.type === 'string'
    ? c.str.include === null && c.str.exclude.length === 0
    : isAllNum(c.num);
}

export function constraintExpression(c: VarConstraint): string | null {
  return c.type === 'string' ? strSetExpression(c.variable, c.str) : numSetExpression(c.variable, c.num);
}

/** A value that satisfies the constraint: null for missing, undefined when none exists. */
export function sampleValue(c: VarConstraint): string | number | null | undefined {
  if (c.opaque.length) return undefined;
  if (c.type === 'string') return pickString(c.str);
  return pickNumber(c.num, c.type === 'integer');
}

export interface ExpectedOutput {
  variable: string;
  /** Null when the value is not a literal (assigned from a variable or expression). */
  value: string | number | boolean | null;
}

/** The outputs a leaf assigns: its outcome's static actions, with the leaf's overrides on top. */
export function leafExpectedOutputs(index: TreeIndex, leafId: string): ExpectedOutput[] {
  const branch = index.branches.get(leafId);
  if (!branch?.outcomeName) return [];
  const outcome = index.outcomes.get(branch.outcomeName);
  const values = new Map<string, ExpectedOutput['value']>();
  for (const a of outcome?.actions ?? []) {
    values.set(a.variableName, a.valueType === 'static' ? a.value : null);
  }
  for (const raw of branch.overrides) {
    const o = raw as { variableName?: string; value?: unknown; valueType?: string };
    if (o && typeof o.variableName === 'string') {
      const literal = typeof o.value === 'string' || typeof o.value === 'number' || typeof o.value === 'boolean';
      values.set(o.variableName, (o.valueType ?? 'static') === 'static' && literal ? (o.value as string | number | boolean) : null);
    }
  }
  return [...values].map(([variable, value]) => ({ variable, value }));
}

/** 1-based display number of a leaf ("Path 12"). */
export function pathNumber(index: TreeIndex, leafId: string): number {
  return (index.leafOrdinal.get(leafId) ?? -1) + 1;
}

/** Leaf ids under a branch, or every leaf for the root (null). */
export function leavesUnder(index: TreeIndex, branchId: string | null): string[] {
  if (!branchId) return index.leafIds;
  const b = index.branches.get(branchId);
  return b ? index.leafIds.slice(b.leafStart, b.leafEnd) : [];
}
