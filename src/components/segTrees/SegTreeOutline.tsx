// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { visibleRows } from '../../utils/segTree/treeView';
import { countInRange, type LeafPrefix } from '../../utils/segTree/leafCounts';
import { highlightParts, type FindResult } from '../../utils/segTree/findInTree';
import type { ResultPrefixes } from './SegTreeSplitView';

interface SegTreeOutlineProps {
  index: TreeIndex;
  expanded: Set<string>;
  onToggle: (branchId: string) => void;
  focusId: string | null;
  shadowedPrefix: LeafPrefix;
  results: ResultPrefixes | null;
  onNavigate: (branchId: string) => void;
  /** Find-in-tree matches to mark; null when nothing is being searched. */
  find?: FindResult | null;
}

/** `text` with the parts matching the find marked (a <mark> is styled with more than colour). */
function Marked({ text, needle }: { text: string; needle: string | null }) {
  if (!needle) return <>{text}</>;
  return (
    <>
      {highlightParts(text, needle).map((p, i) => (p.hit ? <mark key={i} className="segtree-find-hit">{p.text}</mark> : p.text))}
    </>
  );
}

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/**
 * The whole tree as an indented outline (WAI-ARIA tree view). Only the
 * expanded part is rendered. ↑/↓ move, → opens a branch or steps into it,
 * ← closes it or steps out to its parent, Enter/Space selects, Home/End jump.
 */
export default function SegTreeOutline({
  index,
  expanded,
  onToggle,
  focusId,
  shadowedPrefix,
  results,
  onNavigate,
  find = null,
}: SegTreeOutlineProps) {
  const rows = useMemo(() => visibleRows(index, expanded), [index, expanded]);
  const [cursor, setCursor] = useState<string | null>(focusId);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hasFocusRef = useRef(false);

  // Follow the page's selection, and bring it into view.
  useEffect(() => {
    if (!focusId) return;
    setCursor(focusId);
    rowRefs.current.get(focusId)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const cursorId = rows.some((r) => r.branchId === cursor) ? cursor : rows[0]?.branchId ?? null;

  const moveTo = (id: string | null | undefined) => {
    if (!id) return;
    setCursor(id);
    const el = rowRefs.current.get(id);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };

  // After a collapse/expand the row under the cursor re-renders; keep focus on it.
  useEffect(() => {
    if (hasFocusRef.current && cursorId) rowRefs.current.get(cursorId)?.focus();
  }, [rows, cursorId]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const row = rows[i];
    const b = index.branches.get(row.branchId)!;
    const isOpen = expanded.has(row.branchId);
    // Alt+arrows belong to the page's stepper (SegTreeFindBar).
    if (e.altKey) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTo(rows[i + 1]?.branchId); break;
      case 'ArrowUp': e.preventDefault(); moveTo(rows[i - 1]?.branchId); break;
      case 'Home': e.preventDefault(); moveTo(rows[0]?.branchId); break;
      case 'End': e.preventDefault(); moveTo(rows[rows.length - 1]?.branchId); break;
      case 'ArrowRight':
        e.preventDefault();
        if (b.childSplitId && !isOpen) onToggle(row.branchId);
        else if (b.childSplitId) moveTo(rows[i + 1]?.branchId);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (b.childSplitId && isOpen) onToggle(row.branchId);
        else moveTo(row.parentBranchId);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onNavigate(row.branchId);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="segtree-outline"
      role="tree"
      aria-label={`${index.tree.name} outline`}
      onFocus={() => { hasFocusRef.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) hasFocusRef.current = false; }}
    >
      {rows.map((row, i) => {
        const b = index.branches.get(row.branchId)!;
        const split = index.splits.get(b.splitId)!;
        const isLeaf = !b.childSplitId;
        const isOpen = expanded.has(b.id);
        const leaves = b.leafEnd - b.leafStart;
        const shadowed = countInRange(shadowedPrefix, b.leafStart, b.leafEnd);
        const failed = results ? countInRange(results.fail, b.leafStart, b.leafEnd) : 0;
        const passed = results ? countInRange(results.pass, b.leafStart, b.leafEnd) : 0;
        const selected = b.id === focusId;
        const hit = !!find && find.rowIds.has(b.id);
        const needle = hit ? find!.query : null;
        return (
          <div
            key={b.id}
            ref={(el) => {
              if (el) rowRefs.current.set(b.id, el);
              else rowRefs.current.delete(b.id);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={isLeaf ? undefined : isOpen}
            aria-selected={selected}
            tabIndex={b.id === cursorId ? 0 : -1}
            className={`segtree-outline__row${selected ? ' segtree-outline__row--selected' : ''}${hit ? ' segtree-outline__row--match' : ''}`}
            style={{ paddingLeft: `calc(${row.level - 1} * 14px + var(--space-2))` }}
            onClick={() => { setCursor(b.id); onNavigate(b.id); }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {isLeaf ? (
              <span className="segtree-outline__toggle segtree-outline__toggle--leaf" aria-hidden="true" />
            ) : (
              <span
                className={`segtree-outline__toggle${isOpen ? ' segtree-outline__toggle--open' : ''}`}
                aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); setCursor(b.id); onToggle(b.id); }}
              >
                {CHEVRON}
              </span>
            )}
            <span className="segtree-outline__main">
              <span className="segtree-outline__var"><Marked text={split.variable} needle={needle} /></span>
              <span className="segtree-outline__cond"><Marked text={b.label} needle={needle} /></span>
              <span className="segtree-outline__target">
                <span aria-hidden="true">→ </span>
                {isLeaf
                  ? <span className="segtree-branch__outcome">{b.outcomeName ? <Marked text={b.outcomeName} needle={needle} /> : '(no outcome)'}</span>
                  : <Marked text={index.splits.get(b.childSplitId!)?.variable ?? ''} needle={needle} />}
              </span>
              {hit && <span className="sr-only">, matches the search</span>}
            </span>
            <span className="segtree-outline__meta">
              {!isLeaf && (
                <span className="segtree-branch__count">
                  {leaves.toLocaleString()} path{leaves !== 1 ? 's' : ''}
                  {!isOpen ? ' hidden' : ''}
                </span>
              )}
              {shadowed > 0 && (
                <span className="segtree-chip segtree-chip--warn">{isLeaf ? 'Unreachable' : `${shadowed} unreachable`}</span>
              )}
              {failed > 0 && <span className="segtree-chip segtree-chip--fail">{isLeaf ? 'Failed' : `${failed} failed`}</span>}
              {passed > 0 && failed === 0 && <span className="segtree-chip segtree-chip--pass">{isLeaf ? 'Passed' : `${passed} passed`}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
