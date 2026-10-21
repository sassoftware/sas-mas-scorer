// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useLayoutEffect, useRef } from 'react';
import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { pathSteps } from '../../utils/segTree/treeIndex';
import { MenuButton } from '../common';

interface SegTreeBreadcrumbProps {
  index: TreeIndex;
  /** The branch in focus; null for the root. */
  focusId: string | null;
  onNavigate: (branchId: string | null) => void;
}

const HOME_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />
  </svg>
);

/**
 * The path from the root to the focused branch. Each crumb jumps back to that
 * level; its ▾ menu switches to a sibling branch at that level.
 */
export default function SegTreeBreadcrumb({ index, focusId, onNavigate }: SegTreeBreadcrumbProps) {
  const steps = focusId ? pathSteps(index, focusId) : [];
  const listRef = useRef<HTMLOListElement>(null);

  // Long paths wrap; keep the newest crumb in view when the list scrolls.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [focusId]);

  return (
    <nav className="segtree-crumbs" aria-label="Path in tree">
      <ol ref={listRef} className="segtree-crumbs__list">
        <li className="segtree-crumbs__item">
          <button
            type="button"
            className="segtree-crumbs__link segtree-crumbs__link--root"
            onClick={() => onNavigate(null)}
            aria-current={steps.length === 0 ? 'location' : undefined}
          >
            {HOME_ICON}
            <span>All paths</span>
          </button>
        </li>
        {steps.map((step, i) => {
          const split = index.splits.get(step.splitId)!;
          const isLast = i === steps.length - 1;
          const siblings = split.branchIds.map((id) => {
            const b = index.branches.get(id)!;
            const leaves = b.leafEnd - b.leafStart;
            return {
              id,
              label: b.label,
              description: b.childSplitId
                ? `${leaves} path${leaves !== 1 ? 's' : ''}`
                : `→ ${b.outcomeName ?? '(no outcome)'}`,
              checked: id === step.branchId,
              onSelect: () => onNavigate(id),
            };
          });
          return (
            <li key={step.branchId} className="segtree-crumbs__item">
              <span className="segtree-crumbs__sep" aria-hidden="true">›</span>
              <span className="segtree-crumbs__crumb">
                <button
                  type="button"
                  className="segtree-crumbs__link"
                  onClick={() => onNavigate(step.branchId)}
                  aria-current={isLast ? 'location' : undefined}
                >
                  <span className="segtree-crumbs__var">{step.variable}</span>
                  <span className="segtree-crumbs__cond">{step.label}</span>
                </button>
                {siblings.length > 1 && (
                  <MenuButton
                    label=""
                    ariaLabel={`Other ${step.variable} branches`}
                    title={`Switch to another ${step.variable} branch`}
                    triggerClassName="segtree-crumbs__siblings"
                    items={siblings}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
