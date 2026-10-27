// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * "Find in tree" and the Variables summary. A match is a place to go to: a
 * branch whose label or outcome name contains the text, or — for a split
 * whose variable matches — the branch that leads to that split (null for the
 * root split). Matches come in depth-first order, the order of the Outline.
 */

import type { TreeIndex } from './treeIndex';

export interface FindMatch {
  /** Where the match is shown: the branch, or for a split the branch leading to it; null is the root. */
  targetId: string | null;
  /** What matched there, for the screen-reader text and the tooltip. */
  reasons: Array<'variable' | 'label' | 'outcome'>;
}

export interface FindResult {
  query: string;
  matches: FindMatch[];
  /** targetId (or ROOT_KEY) → position in `matches`. */
  position: Map<string, number>;
  /** Branch ids whose Outline row shows matching text (its split variable, label, outcome or the split below it). */
  rowIds: Set<string>;
}

export const ROOT_KEY = '';

/** Branch id → its depth-first position (the order branches were indexed in). */
export function branchOrder(index: TreeIndex): Map<string, number> {
  const order = new Map<string, number>();
  let i = 0;
  for (const id of index.branches.keys()) order.set(id, i++);
  return order;
}

const matchesText = (text: string | null | undefined, needle: string): boolean =>
  !!text && text.toLowerCase().includes(needle);

/** Everything in the tree that matches `query` (case-insensitive substring). */
export function findInTree(index: TreeIndex | null, query: string): FindResult {
  const needle = query.trim().toLowerCase();
  const result: FindResult = { query: needle, matches: [], position: new Map(), rowIds: new Set() };
  if (!needle || !index) return result;

  const add = (targetId: string | null, reason: FindMatch['reasons'][number]) => {
    const key = targetId ?? ROOT_KEY;
    const at = result.position.get(key);
    if (at !== undefined) {
      if (!result.matches[at].reasons.includes(reason)) result.matches[at].reasons.push(reason);
      return;
    }
    result.position.set(key, result.matches.length);
    result.matches.push({ targetId, reasons: [reason] });
  };

  const root = index.rootSplitId ? index.splits.get(index.rootSplitId) : undefined;
  if (root && matchesText(root.variable, needle)) add(null, 'variable');

  // Branches iterate depth-first, and a branch's child split is reported on
  // the branch itself, so the matches come out in Outline order.
  for (const b of index.branches.values()) {
    const split = index.splits.get(b.splitId)!;
    const child = b.childSplitId ? index.splits.get(b.childSplitId) : undefined;
    if (matchesText(b.label, needle)) add(b.id, 'label');
    if (!b.childSplitId && matchesText(b.outcomeName, needle)) add(b.id, 'outcome');
    if (child && matchesText(child.variable, needle)) add(b.id, 'variable');
    if (
      matchesText(split.variable, needle) || matchesText(b.label, needle) ||
      (!b.childSplitId && matchesText(b.outcomeName, needle)) || (child && matchesText(child.variable, needle))
    ) {
      result.rowIds.add(b.id);
    }
  }
  return result;
}

/**
 * The match to go to from the current selection: the next (or previous) one in
 * depth-first order, wrapping. With nothing selected, Next starts at the top
 * and Previous at the bottom.
 */
export function stepMatch(
  find: FindResult,
  order: Map<string, number>,
  focusId: string | null,
  direction: 1 | -1
): FindMatch | null {
  const n = find.matches.length;
  if (n === 0) return null;
  const here = find.position.get(focusId ?? ROOT_KEY);
  if (here !== undefined) return find.matches[(here + direction + n) % n];
  // Not on a match: the first one after (or before) the selection's position.
  const pos = focusId === null ? -1 : order.get(focusId) ?? -1;
  const posOf = (m: FindMatch) => (m.targetId === null ? -1 : order.get(m.targetId) ?? -1);
  if (direction === 1) return find.matches.find((m) => posOf(m) > pos) ?? find.matches[0];
  for (let i = n - 1; i >= 0; i--) if (posOf(find.matches[i]) < pos) return find.matches[i];
  return find.matches[n - 1];
}

/** Case-insensitive pieces of `text` for highlighting: alternating plain and matching runs. */
export function highlightParts(text: string, needle: string): Array<{ text: string; hit: boolean }> {
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

// ─── Variables summary ───

export interface VariableSummary {
  variable: string;
  /** The signature's type, or 'condition' for a boolean-expression split. */
  type: string;
  /** Splits that test it. */
  splits: number;
  /** Shallowest and deepest level it is tested at (1 = the root split). */
  minDepth: number;
  maxDepth: number;
  /** Distinct numeric cut points, ascending. */
  cutPoints: number[];
  /** Distinct text values it is compared with. */
  values: string[];
  /** Branches whose condition could not be read. */
  opaque: number;
}

/** One entry per variable the tree splits on, most-split first. */
export function variableSummary(index: TreeIndex): VariableSummary[] {
  const byVar = new Map<string, VariableSummary & { cuts: Set<number>; texts: Set<string> }>();
  for (const split of index.splits.values()) {
    let s = byVar.get(split.variable);
    if (!s) {
      s = {
        variable: split.variable,
        type: split.isVariable ? index.varTypes.get(split.variable) ?? 'unknown' : 'condition',
        splits: 0,
        minDepth: Infinity,
        maxDepth: 0,
        cutPoints: [],
        values: [],
        opaque: 0,
        cuts: new Set(),
        texts: new Set(),
      };
      byVar.set(split.variable, s);
    }
    s.splits += 1;
    s.minDepth = Math.min(s.minDepth, split.depth + 1);
    s.maxDepth = Math.max(s.maxDepth, split.depth + 1);
    for (const id of split.branchIds) {
      const c = index.branches.get(id)!.condition;
      if (c.kind === 'numeric') {
        for (const iv of c.set.intervals) {
          if (Number.isFinite(iv.lo)) s.cuts.add(iv.lo);
          if (Number.isFinite(iv.hi)) s.cuts.add(iv.hi);
        }
      } else if (c.kind === 'string') {
        for (const v of c.set.include ?? []) s.texts.add(v);
      } else if (c.kind === 'opaque') {
        s.opaque += 1;
      }
    }
  }
  return [...byVar.values()]
    .map(({ cuts, texts, ...rest }) => ({
      ...rest,
      cutPoints: [...cuts].sort((a, b) => a - b),
      values: [...texts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))
    .sort((a, b) => b.splits - a.splits || a.variable.localeCompare(b.variable));
}
