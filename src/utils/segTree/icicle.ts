// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Icicle layout: one row per tree level, each node a block whose width is its
 * share of the paths below the zoom root. Leaves are numbered depth-first,
 * so a branch's paths are the range [leafStart, leafEnd) and its block spans
 * exactly that fraction of the row — no packing step is needed.
 */

import type { TreeIndex } from './treeIndex';

export interface IcicleCell {
  /** null for the root split's own block (the top row of an unzoomed view). */
  branchId: string | null;
  depth: number;
  /** Horizontal extent as fractions 0..1 of the zoomed range. */
  x0: number;
  x1: number;
  isLeaf: boolean;
}

export interface IcicleLayout {
  cells: IcicleCell[];
  rows: number;
  /** The branch the view is zoomed into; null for the whole tree. */
  zoomId: string | null;
}

/**
 * The branch to zoom into for a selection: the selected branch when it has a
 * split below it, else its parent branch (so a selected leaf stays on screen
 * among its siblings), else the whole tree.
 */
export function icicleZoomFor(index: TreeIndex, focusId: string | null): string | null {
  if (!focusId) return null;
  const b = index.branches.get(focusId);
  if (!b) return null;
  if (b.childSplitId) return b.id;
  return index.splits.get(b.splitId)?.parentBranchId ?? null;
}

export function icicleLayout(index: TreeIndex, zoomId: string | null): IcicleLayout {
  const cells: IcicleCell[] = [];
  const zoom = zoomId ? index.branches.get(zoomId) : undefined;
  const start = zoom ? zoom.leafStart : 0;
  const end = zoom ? zoom.leafEnd : index.leafIds.length;
  const span = Math.max(1, end - start);
  let rows = 0;

  const visitSplit = (splitId: string, depth: number) => {
    const split = index.splits.get(splitId);
    if (!split) return;
    for (const id of split.branchIds) {
      const b = index.branches.get(id)!;
      cells.push({
        branchId: id,
        depth,
        x0: (b.leafStart - start) / span,
        x1: (b.leafEnd - start) / span,
        isLeaf: !b.childSplitId,
      });
      rows = Math.max(rows, depth + 1);
      if (b.childSplitId) visitSplit(b.childSplitId, depth + 1);
    }
  };

  // Row 0 is the zoom root itself; its descendants fill the rows below.
  if (zoom) {
    cells.push({ branchId: zoom.id, depth: 0, x0: 0, x1: 1, isLeaf: !zoom.childSplitId });
    rows = 1;
    if (zoom.childSplitId) visitSplit(zoom.childSplitId, 1);
  } else if (index.rootSplitId) {
    cells.push({ branchId: null, depth: 0, x0: 0, x1: 1, isLeaf: false });
    rows = 1;
    visitSplit(index.rootSplitId, 1);
  }
  return { cells, rows, zoomId: zoom ? zoom.id : null };
}
