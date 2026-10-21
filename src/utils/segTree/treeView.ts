// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The expand/collapse model shared by the Outline and Diagram views. A tree
 * of thousands of branches cannot be shown open, so a view starts with the
 * top levels expanded breadth-first until about AUTO_EXPAND_LIMIT branches are
 * visible, and everything deeper stays collapsed behind a "+N paths" handle.
 * `expanded` holds the ids of non-leaf branches whose child split is open.
 */

import { pathBranchIds, type TreeIndex } from './treeIndex';

export const AUTO_EXPAND_LIMIT = 150;

/** Expand level by level, a whole split at a time, while the view stays under `limit` rows. */
export function autoExpand(index: TreeIndex, limit = AUTO_EXPAND_LIMIT): Set<string> {
  const expanded = new Set<string>();
  const root = index.rootSplitId ? index.splits.get(index.rootSplitId) : undefined;
  if (!root) return expanded;
  let visible = root.branchIds.length;
  const queue = [...root.branchIds];
  while (queue.length) {
    const id = queue.shift()!;
    const child = index.branches.get(id)?.childSplitId;
    if (!child) continue;
    const childBranches = index.splits.get(child)!.branchIds;
    if (visible + childBranches.length > limit) continue;
    expanded.add(id);
    visible += childBranches.length;
    queue.push(...childBranches);
  }
  return expanded;
}

/** `expanded` plus every ancestor of `branchId`, so the branch is on screen. */
export function withPathOpen(index: TreeIndex, expanded: Set<string>, branchId: string | null): Set<string> {
  if (!branchId) return expanded;
  const ids = pathBranchIds(index, branchId);
  // The branch itself only needs opening when it has a split below it.
  const ancestors = ids.slice(0, -1);
  if (ancestors.every((id) => expanded.has(id))) return expanded;
  const next = new Set(expanded);
  for (const id of ancestors) next.add(id);
  return next;
}

/** Every non-leaf branch currently showing but collapsed gets opened: one level deeper. */
export function expandOneLevel(index: TreeIndex, expanded: Set<string>): Set<string> {
  const next = new Set(expanded);
  for (const row of visibleRows(index, expanded)) {
    const b = index.branches.get(row.branchId)!;
    if (b.childSplitId && !expanded.has(b.id)) next.add(b.id);
  }
  return next;
}

export function expandAll(index: TreeIndex): Set<string> {
  const next = new Set<string>();
  for (const b of index.branches.values()) if (b.childSplitId) next.add(b.id);
  return next;
}

export interface VisibleRow {
  branchId: string;
  /** 1-based depth (the root split's branches are level 1). */
  level: number;
  /** Position among its siblings, 1-based, and the sibling count (aria-posinset/setsize). */
  posInSet: number;
  setSize: number;
  parentBranchId: string | null;
}

/** The branches a view shows, in depth-first order. */
export function visibleRows(index: TreeIndex, expanded: Set<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (splitId: string, level: number, parentBranchId: string | null) => {
    const split = index.splits.get(splitId);
    if (!split) return;
    split.branchIds.forEach((id, i) => {
      rows.push({ branchId: id, level, posInSet: i + 1, setSize: split.branchIds.length, parentBranchId });
      const child = index.branches.get(id)?.childSplitId;
      if (child && expanded.has(id)) walk(child, level + 1, id);
    });
  };
  if (index.rootSplitId) walk(index.rootSplitId, 1, null);
  return rows;
}

// ─── Diagram layout ───

export const DIAGRAM_NODE_WIDTH = 210;
export const DIAGRAM_NODE_HEIGHT = 52;
const COLUMN_GAP = 150;
const ROW_GAP = 22;

export type DiagramNodeKind = 'split' | 'collapsed' | 'outcome';

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  /** The branch leading to this node; null for the root split. */
  branchId: string | null;
  /** For split and collapsed nodes. */
  splitId: string | null;
  x: number;
  y: number;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  branchId: string;
  label: string;
}

/**
 * A left-to-right tidy tree: every terminal node (an outcome, or a collapsed
 * split) takes the next row, and an open split sits halfway between its first
 * and last child. Linear in the number of visible nodes, which matters when a
 * user opens a few thousand of them.
 */
export function diagramLayout(index: TreeIndex, expanded: Set<string>): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let nextRow = 0;
  const rowY = () => (nextRow++) * (DIAGRAM_NODE_HEIGHT + ROW_GAP);
  const colX = (depth: number) => depth * (DIAGRAM_NODE_WIDTH + COLUMN_GAP);

  // Returns the y of the node placed for this split.
  const placeSplit = (splitId: string, branchId: string | null, depth: number): number => {
    const id = `s:${splitId}`;
    const open = branchId === null || expanded.has(branchId);
    if (!open) {
      const y = rowY();
      nodes.push({ id, kind: 'collapsed', branchId, splitId, x: colX(depth), y });
      return y;
    }
    const split = index.splits.get(splitId)!;
    const childYs: number[] = [];
    split.branchIds.forEach((bid, i) => {
      const b = index.branches.get(bid)!;
      let target: string;
      if (b.childSplitId) {
        childYs.push(placeSplit(b.childSplitId, bid, depth + 1));
        target = `s:${b.childSplitId}`;
      } else {
        const y = rowY();
        target = `o:${bid}`;
        nodes.push({ id: target, kind: 'outcome', branchId: bid, splitId: null, x: colX(depth + 1), y });
        childYs.push(y);
      }
      edges.push({ id: `e:${bid}`, source: id, target, branchId: bid, label: `${i + 1}. ${b.label}` });
    });
    const y = childYs.length ? (childYs[0] + childYs[childYs.length - 1]) / 2 : rowY();
    nodes.push({ id, kind: 'split', branchId, splitId, x: colX(depth), y });
    return y;
  };

  if (index.rootSplitId) placeSplit(index.rootSplitId, null, 0);
  return { nodes, edges };
}
