// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TreeIndex } from './treeIndex';

/**
 * Prefix sums over the depth-first leaf order. Every subtree's leaves are one
 * contiguous range, so "how many leaves below this branch are X" is a single
 * subtraction however large the tree is.
 */
export type LeafPrefix = Int32Array;

export function leafPrefix(index: TreeIndex, test: (leafId: string) => boolean): LeafPrefix {
  const prefix = new Int32Array(index.leafIds.length + 1);
  index.leafIds.forEach((id, i) => {
    prefix[i + 1] = prefix[i] + (test(id) ? 1 : 0);
  });
  return prefix;
}

export function countInRange(prefix: LeafPrefix, start: number, end: number): number {
  return prefix[end] - prefix[start];
}

export type StepDirection = 1 | -1;

/**
 * The first leaf after `fromOrdinal` (direction 1) or before it (direction
 * -1) that passes `test`, wrapping round the ends; null when none does.
 * `fromOrdinal` may lie outside the leaves (-1, or `leafIds.length`).
 */
export function nextLeaf(
  index: TreeIndex,
  fromOrdinal: number,
  test: (leafId: string) => boolean,
  direction: StepDirection = 1
): string | null {
  const n = index.leafIds.length;
  for (let step = 1; step <= n; step++) {
    const id = index.leafIds[(((fromOrdinal + step * direction) % n) + n) % n];
    if (test(id)) return id;
  }
  return null;
}

/**
 * Where stepping starts from for a selection: the selected leaf itself, or,
 * for a branch with paths below it, just before its first leaf going forward
 * and just after its last leaf going back (so its own paths come first either
 * way). Nothing selected starts outside the ends.
 */
export function stepOrigin(index: TreeIndex, focusId: string | null, direction: StepDirection): number {
  const b = focusId ? index.branches.get(focusId) : undefined;
  if (!b) return direction === 1 ? -1 : index.leafIds.length;
  if (!b.childSplitId) return index.leafOrdinal.get(b.id) ?? -1;
  return direction === 1 ? b.leafStart - 1 : b.leafEnd;
}

/** The leaf the selection is on, as a 0-based position among those passing `test`; -1 when not on one. */
export function leafRank(index: TreeIndex, focusId: string | null, prefix: LeafPrefix, test: (leafId: string) => boolean): number {
  const b = focusId ? index.branches.get(focusId) : undefined;
  if (!b || b.childSplitId || !test(b.id)) return -1;
  const ordinal = index.leafOrdinal.get(b.id) ?? -1;
  return ordinal < 0 ? -1 : prefix[ordinal];
}
