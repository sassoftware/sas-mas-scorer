// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { leafExpectedOutputs, NO_OUTCOME, type TreeIndex } from '../../utils/segTree/treeIndex';
import { countInRange, leafPrefix, type LeafPrefix } from '../../utils/segTree/leafCounts';
import { icicleLayout, icicleZoomFor, type IcicleCell } from '../../utils/segTree/icicle';
import { Button } from '../common';
import type { ResultPrefixes } from './SegTreeSplitView';

interface SegTreeIcicleProps {
  index: TreeIndex;
  focusId: string | null;
  shadowedPrefix: LeafPrefix;
  results: ResultPrefixes | null;
  onNavigate: (branchId: string | null) => void;
}

const ROW_HEIGHT = 28;
const LABEL_MIN_WIDTH = 44;
const CHAR_WIDTH = 6.3;

// Fills. Structure uses the app's split/outcome tints; "share" is the
// validated single-hue blue sequential ramp (steps 150-550, light -> dark);
// issues use the reserved status colours and always come with a legend label.
// Split and outcome need to read apart at a glance: a light blue against a
// clearly stronger teal (dark ink stays well above 4.5:1 on both).
const FILL_SPLIT = '#DCE9F7';
const FILL_LEAF = '#8FD3C1';
const FILL_NONE = '#F4F4F4';
const SHARE_STEPS = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];
// Issues: the strong status colour marks the path itself; its light tint
// marks the blocks that lead to it, so the route shows without drowning the view.
const FILL_FAILED = '#F44336';
const TINT_FAILED = '#FFCDD2';
const FILL_DEAD = '#FF9800';
const TINT_DEAD = '#FFE0B2';
const FILL_PASSED = '#4CAF50';
const TINT_PASSED = '#E8F5E9';
const INK = '#1A1A1A';
const INK_ON_DARK = '#FFFFFF';

type ShadeMode = 'structure' | 'share' | 'issues';

const pct = (n: number, d: number) => (d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`);

function shareFill(share: number): { fill: string; ink: string } {
  if (share <= 0) return { fill: FILL_NONE, ink: INK };
  const i = Math.min(SHARE_STEPS.length - 1, Math.ceil(share * SHARE_STEPS.length) - 1);
  return { fill: SHARE_STEPS[i], ink: i >= 3 ? INK_ON_DARK : INK };
}

/**
 * The hover card. It lives on document.body with fixed positioning, so the
 * chart's scrolling box cannot clip it, and it flips to the other side of the
 * pointer when the window edge is close.
 */
function IcicleTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 16 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const margin = 8;
    let left = x + 14;
    let top = y + 16;
    if (left + w > window.innerWidth - margin) left = x - w - 14;
    if (top + h > window.innerHeight - margin) top = y - h - 12;
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [x, y, children]);
  return createPortal(
    <div ref={ref} className="segtree-icicle__tip" style={pos} role="presentation">
      {children}
    </div>,
    document.body
  );
}

/**
 * The tree as an icicle: one row per level, block width = share of the paths
 * below. Clicking a block selects it and zooms into it; the arrow keys walk
 * the tree from one tab stop (↑ parent, ↓ first child, ←/→ siblings).
 */
export default function SegTreeIcicle({ index, focusId, shadowedPrefix, results, onNavigate }: SegTreeIcicleProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [mode, setMode] = useState<ShadeMode>('structure');
  // Default to the output with the fewest distinct values (a group, not an id):
  // shading by a value only says something when that value covers many paths.
  const [shareVar, setShareVar] = useState(() => {
    let best = index.outputVariables[0] ?? '';
    let bestCount = Infinity;
    for (const v of index.outputVariables) {
      const distinct = new Set(index.leafIds.map((id) => String(leafExpectedOutputs(index, id).find((o) => o.variable === v)?.value ?? ''))).size;
      if (distinct > 1 && distinct < bestCount) {
        best = v;
        bestCount = distinct;
      }
    }
    return best;
  });
  const [shareValue, setShareValue] = useState('');
  const [hover, setHover] = useState<{ cell: IcicleCell; x: number; y: number } | null>(null);
  const descId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Output values with how many paths assign each, most common first.
  const valueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!shareVar) return [] as [string, number][];
    for (const id of index.leafIds) {
      const o = leafExpectedOutputs(index, id).find((x) => x.variable === shareVar);
      const v = o ? String(o.value ?? '(not a literal)') : '(not assigned)';
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [index, shareVar]);

  const value = shareValue && valueCounts.some(([v]) => v === shareValue) ? shareValue : valueCounts[0]?.[0] ?? '';

  const matchPrefix = useMemo(() => {
    if (mode !== 'share' || !shareVar) return null;
    return leafPrefix(index, (id) => {
      const o = leafExpectedOutputs(index, id).find((x) => x.variable === shareVar);
      return (o ? String(o.value ?? '(not a literal)') : '(not assigned)') === value;
    });
  }, [index, mode, shareVar, value]);

  const zoomId = icicleZoomFor(index, focusId);
  const layout = useMemo(() => icicleLayout(index, zoomId), [index, zoomId]);
  // A zoom moves every block; a tooltip from before it would describe the wrong one.
  useEffect(() => setHover(null), [layout]);
  const height = layout.rows * ROW_HEIGHT;

  const rangeOf = (cell: IcicleCell) => {
    const b = cell.branchId ? index.branches.get(cell.branchId) : undefined;
    return b ? [b.leafStart, b.leafEnd] : [0, index.leafIds.length];
  };

  const styleOf = (cell: IcicleCell): { fill: string; ink: string } => {
    const [s, e] = rangeOf(cell);
    if (mode === 'share' && matchPrefix) return shareFill(countInRange(matchPrefix, s, e) / Math.max(1, e - s));
    if (mode === 'issues') {
      const leaf = cell.isLeaf;
      if (results && countInRange(results.fail, s, e) > 0) return { fill: leaf ? FILL_FAILED : TINT_FAILED, ink: INK };
      if (countInRange(shadowedPrefix, s, e) > 0) return { fill: leaf ? FILL_DEAD : TINT_DEAD, ink: INK };
      if (results && countInRange(results.pass, s, e) > 0) return { fill: leaf ? FILL_PASSED : TINT_PASSED, ink: INK };
      return { fill: FILL_NONE, ink: INK };
    }
    return { fill: cell.isLeaf ? FILL_LEAF : FILL_SPLIT, ink: INK };
  };

  const labelOf = (cell: IcicleCell): string => {
    if (!cell.branchId) return index.splits.get(index.rootSplitId ?? '')?.variable ?? '';
    const b = index.branches.get(cell.branchId)!;
    const target = b.childSplitId ? index.splits.get(b.childSplitId)?.variable : b.outcomeName ?? '(no outcome)';
    return `${b.label} → ${target}`;
  };

  // The blocks re-render only when the picture changes, not on every hover.
  const blocks = useMemo(() => layout.cells.map((cell, i) => {
    const x = cell.x0 * width;
    const w = (cell.x1 - cell.x0) * width;
    const y = cell.depth * ROW_HEIGHT;
    const { fill, ink } = styleOf(cell);
    // A 2px surface gap between neighbours, kept only where the block is wide enough.
    const gap = w > 3 ? 1 : 0;
    const selected = cell.branchId === focusId && focusId !== null;
    const text = labelOf(cell);
    const max = Math.floor((w - 8) / CHAR_WIDTH);
    const shown = w >= LABEL_MIN_WIDTH ? (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text) : '';
    return (
      <g key={cell.branchId ?? 'root'} data-cell={i}>
        <rect
          x={x + gap}
          y={y + 1}
          width={Math.max(0.5, w - gap * 2)}
          height={ROW_HEIGHT - 2}
          fill={fill}
          stroke={selected ? INK : undefined}
          strokeWidth={selected ? 2 : undefined}
          rx={2}
        />
        {shown && (
          <text x={x + w / 2} y={y + ROW_HEIGHT / 2 + 4} textAnchor="middle" fontSize={11} fill={ink} pointerEvents="none">
            {shown}
          </text>
        )}
      </g>
    );
    // styleOf/labelOf read only the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layout, width, mode, matchPrefix, results, shadowedPrefix, focusId, index]);

  const cellAt = (target: EventTarget | null): IcicleCell | null => {
    const g = (target as Element | null)?.closest?.('[data-cell]');
    const i = g ? Number(g.getAttribute('data-cell')) : NaN;
    return Number.isFinite(i) ? layout.cells[i] : null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const b = focusId ? index.branches.get(focusId) : undefined;
    const split = b ? index.splits.get(b.splitId) : undefined;
    let next: string | null | undefined;
    switch (e.key) {
      case 'ArrowUp': next = split ? split.parentBranchId : undefined; break;
      case 'ArrowDown': {
        const child = b ? b.childSplitId : index.rootSplitId;
        next = child ? index.splits.get(child)?.branchIds[0] : undefined;
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!b || !split) break;
        const i = split.branchIds.indexOf(b.id) + (e.key === 'ArrowRight' ? 1 : -1);
        next = split.branchIds[i];
        break;
      }
      default: return;
    }
    e.preventDefault();
    if (next !== undefined) onNavigate(next);
  };

  const describe = (cell: IcicleCell) => {
    const [s, e] = rangeOf(cell);
    const paths = e - s;
    const b = cell.branchId ? index.branches.get(cell.branchId) : undefined;
    const split = b ? index.splits.get(b.splitId) : undefined;
    const dead = countInRange(shadowedPrefix, s, e);
    const failed = results ? countInRange(results.fail, s, e) : 0;
    const passed = results ? countInRange(results.pass, s, e) : 0;
    const match = matchPrefix ? countInRange(matchPrefix, s, e) : 0;
    return {
      title: b && split ? `${split.variable}: ${b.label}` : 'All paths',
      target: b ? (b.childSplitId ? `→ splits on ${index.splits.get(b.childSplitId)?.variable}` : `→ ${b.outcomeName ?? '(no outcome)'}`) : `→ splits on ${index.splits.get(index.rootSplitId ?? '')?.variable}`,
      lines: [
        `Paths: ${paths.toLocaleString()}`,
        ...(b && !b.childSplitId ? [] : [`Outcomes: ${(b ? b.outcomeCount : index.outcomes.size).toLocaleString()}`]),
        ...(mode === 'share' ? [`${shareVar} = ${value}: ${match.toLocaleString()} of ${paths.toLocaleString()} paths (${pct(match, paths)})`] : []),
        ...(dead ? [`Dead ends: ${dead.toLocaleString()}`] : []),
        ...(results && (failed || passed) ? [`Last test: ${passed.toLocaleString()} passed, ${failed.toLocaleString()} failed`] : []),
      ],
    };
  };

  const zoom = layout.zoomId ? index.branches.get(layout.zoomId) : undefined;
  const zoomParent = zoom ? index.splits.get(zoom.splitId)?.parentBranchId ?? null : null;
  const focusCell = layout.cells.find((c) => c.branchId === focusId) ?? layout.cells[0];
  const focusInfo = focusCell ? describe(focusCell) : null;
  const hoverInfo = hover ? describe(hover.cell) : null;

  return (
    <div className="segtree-icicle">
      <div className="segtree-icicle__bar">
        <label className="segtree-icicle__control">
          <span>Shade by</span>
          <select className="sas-input segtree-input--compact" value={mode} onChange={(e) => setMode(e.target.value as ShadeMode)}>
            <option value="structure">Splits and outcomes</option>
            {index.outputVariables.length > 0 && <option value="share">Share of an output value</option>}
            <option value="issues">Dead ends{results ? ' and test results' : ''}</option>
          </select>
        </label>
        {mode === 'share' && (
          <>
            <label className="segtree-icicle__control">
              <span>Output</span>
              <select className="sas-input segtree-input--compact" value={shareVar} onChange={(e) => { setShareVar(e.target.value); setShareValue(''); }}>
                {index.outputVariables.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="segtree-icicle__control">
              <span>Value</span>
              <select className="sas-input segtree-input--compact" value={value} onChange={(e) => setShareValue(e.target.value)}>
                {valueCounts.map(([v, n]) => (
                  <option key={v} value={v}>{v === NO_OUTCOME ? '(blank)' : v} — {n.toLocaleString()} path{n !== 1 ? 's' : ''}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {zoom && (
          <Button variant="tertiary" size="small" onClick={() => onNavigate(zoomParent)}>Zoom out one level</Button>
        )}
      </div>

      <div className="segtree-icicle__legend">
        {mode === 'structure' && (
          <>
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_SPLIT }} />Split (has branches below)</span>
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_LEAF }} />Outcome</span>
            <span className="segtree-icicle__note">Width = share of paths</span>
          </>
        )}
        {mode === 'share' && (
          <>
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_NONE }} />None</span>
            <span className="segtree-icicle__ramp" style={{ background: `linear-gradient(to right, ${SHARE_STEPS.join(', ')})` }} />
            <span className="segtree-icicle__note">0% → 100% of the paths below assign {shareVar} = {value}</span>
          </>
        )}
        {mode === 'issues' && (
          <>
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_DEAD }} />Dead end</span>
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: TINT_DEAD }} />Leads to a dead end</span>
            {results && <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_FAILED }} />Failed path</span>}
            {results && <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: TINT_FAILED }} />Leads to a failed path</span>}
            {results && <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_PASSED }} />Passed</span>}
            <span className="segtree-icicle__key"><span className="segtree-icicle__swatch" style={{ background: FILL_NONE }} />{results ? 'Not tested' : 'No dead ends'}</span>
          </>
        )}
      </div>

      <div
        ref={wrapRef}
        className="segtree-icicle__canvas"
        onMouseLeave={() => setHover(null)}
      >
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={`${index.tree.name} icicle${zoom ? ', zoomed in' : ''}. Arrow keys move between nodes.`}
          aria-describedby={descId}
          tabIndex={0}
          className="segtree-icicle__svg"
          onKeyDown={onKeyDown}
          onClick={(e) => {
            const cell = cellAt(e.target);
            if (cell) onNavigate(cell.branchId);
          }}
          onMouseMove={(e) => {
            const cell = cellAt(e.target);
            if (!cell) { setHover(null); return; }
            setHover({ cell, x: e.clientX, y: e.clientY });
          }}
        >
          {blocks}
        </svg>
        {hover && hoverInfo && (
          <IcicleTip x={hover.x} y={hover.y}>
            <strong>{hoverInfo.title}</strong>
            <span className="segtree-icicle__tip-target">{hoverInfo.target}</span>
            {hoverInfo.lines.map((l) => <span key={l}>{l}</span>)}
          </IcicleTip>
        )}
      </div>

      <p id={descId} className="segtree-icicle__focus" aria-live="polite">
        {focusInfo ? `${focusInfo.title} ${focusInfo.target}. ${focusInfo.lines.join('. ')}.` : ''}
      </p>
    </div>
  );
}
