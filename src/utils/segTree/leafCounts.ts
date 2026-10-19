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

/** The first leaf after `fromOrdinal` (wrapping) that passes `test`, or null. */
export function nextLeaf(index: TreeIndex, fromOrdinal: number, test: (leafId: string) => boolean): string | null {
  const n = index.leafIds.length;
  for (let step = 1; step <= n; step++) {
    const id = index.leafIds[(fromOrdinal + step + n) % n];
    if (test(id)) return id;
  }
  return null;
}
