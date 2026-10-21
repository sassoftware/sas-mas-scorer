// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { countInRange, type LeafPrefix } from '../../utils/segTree/leafCounts';

export interface ResultPrefixes {
  pass: LeafPrefix;
  fail: LeafPrefix;
}

interface SegTreeSplitViewProps {
  index: TreeIndex;
  splitId: string;
  /** The branch of this split that is in focus (a leaf being inspected), if any. */
  activeBranchId: string | null;
  shadowedPrefix: LeafPrefix;
  results: ResultPrefixes | null;
  onNavigate: (branchId: string) => void;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n !== 1 ? 's' : ''}`;

/** The branches of one split, in test order, with what lies below each. */
export default function SegTreeSplitView({
  index,
  splitId,
  activeBranchId,
  shadowedPrefix,
  results,
  onNavigate,
}: SegTreeSplitViewProps) {
  const split = index.splits.get(splitId);
  if (!split) return null;

  return (
    <section className="segtree-split" aria-labelledby="segtree-split-title">
      <header className="segtree-split__header">
        <h2 id="segtree-split-title" className="segtree-split__title">
          {split.isVariable ? 'Split on ' : ''}
          <span className="segtree-split__var">{split.variable}</span>
        </h2>
        <span className="segtree-split__meta">
          Level {split.depth + 1} · branches are tested top to bottom, first match wins
        </span>
      </header>

      <ol className="segtree-split__list">
        {split.branchIds.map((id, i) => {
          const b = index.branches.get(id)!;
          const leaves = b.leafEnd - b.leafStart;
          const shadowed = countInRange(shadowedPrefix, b.leafStart, b.leafEnd);
          const failed = results ? countInRange(results.fail, b.leafStart, b.leafEnd) : 0;
          const passed = results ? countInRange(results.pass, b.leafStart, b.leafEnd) : 0;
          const isLeaf = !b.childSplitId;
          const target = isLeaf
            ? b.outcomeName ?? '(no outcome)'
            : `splits on ${index.splits.get(b.childSplitId!)?.variable ?? '…'}`;
          return (
            <li key={id}>
              <button
                type="button"
                className={`segtree-branch${id === activeBranchId ? ' segtree-branch--active' : ''}${isLeaf ? ' segtree-branch--leaf' : ''}`}
                aria-current={id === activeBranchId ? 'true' : undefined}
                onClick={() => onNavigate(id)}
              >
                <span className="segtree-branch__order" aria-hidden="true">{i + 1}</span>
                <span className="segtree-branch__main">
                  <span className="segtree-branch__cond">{b.label}</span>
                  <span className="segtree-branch__target">
                    <span aria-hidden="true">→ </span>
                    {isLeaf ? <span className="segtree-branch__outcome">{target}</span> : target}
                  </span>
                </span>
                <span className="segtree-branch__stats">
                  {!isLeaf && (
                    <span className="segtree-branch__count">
                      {plural(leaves, 'path')} · {plural(b.outcomeCount, 'outcome')}
                    </span>
                  )}
                  <span className="segtree-branch__chips">
                    {shadowed > 0 && (
                      <span className="segtree-chip segtree-chip--warn">
                        {isLeaf ? 'Unreachable' : `${shadowed.toLocaleString()} unreachable`}
                      </span>
                    )}
                    {failed > 0 && (
                      <span className="segtree-chip segtree-chip--fail">
                        {isLeaf ? 'Failed' : `${failed.toLocaleString()} failed`}
                      </span>
                    )}
                    {passed > 0 && failed === 0 && (
                      <span className="segtree-chip segtree-chip--pass">
                        {isLeaf ? 'Passed' : `${passed.toLocaleString()} passed`}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
