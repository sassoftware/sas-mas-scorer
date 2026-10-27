// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef } from 'react';
import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { leafRank, nextLeaf, stepOrigin, type LeafPrefix, type StepDirection } from '../../utils/segTree/leafCounts';
import { branchOrder, ROOT_KEY, stepMatch, type FindResult } from '../../utils/segTree/findInTree';
import type { RowResult } from '../../utils/segTree/testRows';
import { Button, SearchInput, isAnyModalOpen } from '../common';
import SegTreeVariables from './SegTreeVariables';

export type StepMode = 'matches' | 'paths' | 'deadEnds' | 'failed';

interface SegTreeFindBarProps {
  index: TreeIndex;
  focusId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** Matches of the (deferred) query. */
  find: FindResult;
  mode: StepMode;
  onModeChange: (mode: StepMode) => void;
  shadowedPrefix: LeafPrefix;
  /** Failed paths of the test results on show; null when none are shown. */
  failPrefix: LeafPrefix | null;
  results: Map<string, RowResult> | null;
  onNavigate: (branchId: string | null) => void;
}

const PREV_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
  </svg>
);
const NEXT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
  </svg>
);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Text fields where Alt+↑/↓ belong to the field (a select opens its list with Alt+↓). */
function ownsAltArrows(target: EventTarget | null, findInput: HTMLElement | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === findInput) return false;
  const tag = el.tagName;
  return tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio') || el.isContentEditable;
}

/**
 * Find in tree, and one Previous / Next stepper for what is chosen: the find
 * matches, every path, the dead ends or the failed paths of the test on show.
 * Enter / Shift+Enter in the find box and Alt+↓ / Alt+↑ anywhere on the page
 * step forward and back; the Outline and the Icicle leave Alt+arrows alone.
 */
export default function SegTreeFindBar({
  index,
  focusId,
  query,
  onQueryChange,
  find,
  mode,
  onModeChange,
  shadowedPrefix,
  failPrefix,
  results,
  onNavigate,
}: SegTreeFindBarProps) {
  const order = useMemo(() => branchOrder(index), [index]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const deadEnds = index.shadowedCount;
  const failed = failPrefix ? failPrefix[failPrefix.length - 1] : 0;

  const isDead = (id: string) => index.leafStatus.get(id) === 'shadowed';
  const isFailed = (id: string) => results?.get(id)?.status === 'fail';

  const total = mode === 'matches' ? find.matches.length
    : mode === 'paths' ? index.leafIds.length
      : mode === 'deadEnds' ? deadEnds
        : failed;

  // 1-based position of the selection in the chosen list; 0 when it is not on one.
  const position = (() => {
    if (mode === 'matches') return (find.position.get(focusId ?? ROOT_KEY) ?? -1) + 1;
    const f = focusId ? index.branches.get(focusId) : undefined;
    if (mode === 'paths') return f && !f.childSplitId ? (index.leafOrdinal.get(f.id) ?? -1) + 1 : 0;
    if (mode === 'deadEnds') return leafRank(index, focusId, shadowedPrefix, isDead) + 1;
    return failPrefix ? leafRank(index, focusId, failPrefix, isFailed) + 1 : 0;
  })();

  const noun = mode === 'matches' ? ['match', 'matches'] : mode === 'paths' ? ['path', 'paths'] : mode === 'deadEnds' ? ['dead end', 'dead ends'] : ['failed path', 'failed paths'];
  const status = mode === 'matches' && !find.query
    ? 'Type to find'
    : total === 0
      ? `No ${noun[1]}`
      : position > 0
        ? `${noun[0][0].toUpperCase()}${noun[0].slice(1)} ${position.toLocaleString()} of ${total.toLocaleString()}`
        : plural(total, noun[0], noun[1]);

  const step = (direction: StepDirection) => {
    if (total === 0) return;
    if (mode === 'matches') {
      const m = stepMatch(find, order, focusId, direction);
      if (m) onNavigate(m.targetId);
      return;
    }
    const test = mode === 'paths' ? () => true : mode === 'deadEnds' ? isDead : isFailed;
    const id = nextLeaf(index, stepOrigin(index, focusId, direction), test, direction);
    if (id) onNavigate(id);
  };

  // Alt+↓ / Alt+↑ anywhere on the explorer, except where a field or an open dialog owns the keys.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (isAnyModalOpen()) return;
      const findInput = wrapRef.current?.querySelector('input') ?? null;
      if (ownsAltArrows(e.target, findInput)) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowDown' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return;
    e.preventDefault();
    // Enter in the find box always steps through the matches, whatever the list was.
    if (mode !== 'matches') onModeChange('matches');
    const m = stepMatch(find, order, focusId, e.shiftKey ? -1 : 1);
    if (m) onNavigate(m.targetId);
  };

  return (
    <div className="segtree-find">
      <div className="segtree-find__bar" role="search" aria-label="Find in tree" ref={wrapRef} onKeyDown={onFindKey}>
        <SearchInput
          aria-label="Find in tree: variable, branch condition or outcome"
          value={query}
          onChange={(v) => {
            onQueryChange(v);
            if (v.trim() && mode !== 'matches') onModeChange('matches');
          }}
          placeholder="Find variable, condition or outcome..."
          className="segtree-find__search"
        />
        <label className="segtree-find__mode">
          <span>Step through</span>
          <select className="sas-input segtree-input--compact" value={mode} onChange={(e) => onModeChange(e.target.value as StepMode)}>
            <option value="matches">Find matches</option>
            <option value="paths">All paths ({index.leafIds.length.toLocaleString()})</option>
            {deadEnds > 0 && <option value="deadEnds">Dead ends ({deadEnds.toLocaleString()})</option>}
            {failPrefix && <option value="failed">Failed paths ({failed.toLocaleString()})</option>}
          </select>
        </label>
        <Button
          variant="secondary"
          size="small"
          icon={PREV_ICON}
          disabled={total === 0}
          onClick={() => step(-1)}
          title="Previous (Alt+↑; Shift+Enter in the find box)"
          aria-keyshortcuts="Alt+ArrowUp"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="small"
          icon={NEXT_ICON}
          disabled={total === 0}
          onClick={() => step(1)}
          title="Next (Alt+↓; Enter in the find box)"
          aria-keyshortcuts="Alt+ArrowDown"
        >
          Next
        </Button>
        <span className="segtree-find__status" role="status" aria-live="polite" aria-atomic="true">{status}</span>
        <details className="segtree-find__keys">
          <summary>Shortcuts</summary>
          <ul>
            <li><kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> in the find box: next / previous match</li>
            <li><kbd>Alt</kbd>+<kbd>↓</kbd> / <kbd>Alt</kbd>+<kbd>↑</kbd> anywhere on this page: next / previous in the chosen list</li>
            <li>Matches are marked in the Outline and the Icicle; the selected one is shown in every view.</li>
          </ul>
        </details>
      </div>
      <SegTreeVariables index={index} onFind={(v) => { onQueryChange(v); onModeChange('matches'); }} />
    </div>
  );
}
