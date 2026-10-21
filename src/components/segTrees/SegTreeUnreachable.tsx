// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useId, useState } from 'react';
import {
  explainUnreachable,
  pathBranchIds,
  pathNumber,
  type TreeIndex,
  type UnreachableReason,
} from '../../utils/segTree/treeIndex';
import { Button } from '../common';

const steps = (n: number[]) => (n.length === 1 ? `step ${n[0]}` : `steps ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
const quote = (s: string) => `“${s}”`;

/** One line for a list: what conflicts with what. */
export function shortReason(r: UnreachableReason): string {
  if (r.kind === 'contradiction') {
    return `${steps(r.earlierSteps)} only let${r.earlierSteps.length === 1 ? 's' : ''} through ${r.allowed}; step ${r.step} then asks for ${r.variable} ${r.asked}`;
  }
  return `at step ${r.step}, ${r.blockers.map(quote).join(', ')} already catch${r.blockers.length === 1 ? 'es' : ''} every record ${quote(r.asked)} would take`;
}

interface UnreachableBannerProps {
  index: TreeIndex;
  onNavigate: (branchId: string) => void;
}

/** The page-level notice: what "unreachable" means, and every such path with its reason. */
export function UnreachableBanner({ index, onNavigate }: UnreachableBannerProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const leaves = index.leafIds.filter((id) => index.leafStatus.get(id) === 'shadowed');
  if (leaves.length === 0) return null;
  const n = leaves.length;
  // A concrete example from this tree reads better than an abstract rule.
  const first = explainUnreachable(index, leaves[0]);
  const example = !first
    ? ''
    : first.kind === 'contradiction'
      ? ` — on Path ${pathNumber(index, leaves[0])}, for example, ${steps(first.earlierSteps)} only let${first.earlierSteps.length === 1 ? 's' : ''} through ${first.allowed}, and step ${first.step} then asks for ${first.variable} ${first.asked}`
      : ` — on Path ${pathNumber(index, leaves[0])}, for example, ${quote(first.asked)} sits below ${first.blockers.map(quote).join(', ')}, which already catch${first.blockers.length === 1 ? 'es' : ''} everything it would take`;

  return (
    <div className="segtree-unreachable" role="region" aria-label="Unreachable paths">
      <div className="segtree-unreachable__head">
        <svg className="segtree-unreachable__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        </svg>
        <div className="segtree-unreachable__text">
          <strong>{n} {n === 1 ? 'branch is a dead end' : 'branches are dead ends'} — no record can ever reach {n === 1 ? 'it' : 'them'}</strong>
          <p>
            Each one asks for values that earlier steps on the same path have already sent elsewhere{example},
            so its outcome never fires from there. Scoring is not affected — every record still gets an outcome
            from another branch — but the dead branches are almost always a mistake, typically left over from
            building the tree out of a strategy table. Delete or correct them in SAS Intelligent Decisioning.
          </p>
        </div>
        <Button variant="secondary" size="small" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'} {n === 1 ? 'it' : `the ${n}`}
        </Button>
      </div>
      {open && (
        <ul id={listId} className="segtree-unreachable__list">
          {leaves.map((id) => {
            const r = explainUnreachable(index, id);
            const b = index.branches.get(id)!;
            return (
              <li key={id}>
                <button type="button" className="segtree-unreachable__item" onClick={() => onNavigate(id)}>
                  <span className="segtree-unreachable__name">
                    Path {pathNumber(index, id)} → {b.outcomeName ?? '(no outcome)'}
                  </span>
                  {r && <span className="segtree-unreachable__why">{shortReason(r)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface UnreachableExplanationProps {
  index: TreeIndex;
  leafId: string;
  /** Jump to a point in the tree; null for the top. */
  onNavigate: (branchId: string | null) => void;
}

/** The path panel's "why" and "how to fix" for one unreachable path. */
export function UnreachableExplanation({ index, leafId, onNavigate }: UnreachableExplanationProps) {
  const r = explainUnreachable(index, leafId);
  const ids = pathBranchIds(index, leafId);
  const outcome = index.branches.get(leafId)?.outcomeName;
  // Showing step n means showing its split: select the branch just above it.
  const showStep = (n: number) => onNavigate(n >= 2 ? ids[n - 2] : null);
  const label = (n: number) => {
    const b = index.branches.get(ids[n - 1])!;
    return `${index.splits.get(b.splitId)!.variable}: ${b.label}`;
  };

  if (!r) {
    return (
      <div className="segtree-why" role="note">
        <h3 className="segtree-why__title">No record can reach this path</h3>
        <p>Earlier branches already take every value it accepts.</p>
      </div>
    );
  }

  return (
    <div className="segtree-why" role="note">
      <h3 className="segtree-why__title">Why no record can reach this path</h3>
      {r.kind === 'contradiction' ? (
        <>
          <ol className="segtree-why__steps">
            {r.earlierSteps.map((n) => (
              <li key={n}>
                <button type="button" className="segtree-why__step" onClick={() => showStep(n)}>Step {n}</button>{' '}
                <code>{label(n)}</code>
              </li>
            ))}
            <li>
              <button type="button" className="segtree-why__step" onClick={() => showStep(r.step)}>Step {r.step}</button>{' '}
              <code>{label(r.step)}</code>
            </li>
          </ol>
          <p>
            Before step {r.step}, the path only lets through records where <strong>{r.allowed}</strong>.
            Step {r.step} then asks for <strong>{r.variable} {r.asked}</strong>. No value can be both,
            so this branch never matches{outcome ? <> and <strong>{outcome}</strong> is never assigned from here</> : null}.
          </p>
          <h4 className="segtree-why__subtitle">How to fix it in SAS Intelligent Decisioning</h4>
          <ul className="segtree-why__fixes">
            <li>
              If the branch should not exist, delete the {quote(r.asked)} branch at step {r.step}. Every record
              that reaches that split already goes to one of its other branches, so nothing changes for scoring.
            </li>
            <li>
              If it should exist, one of the {r.variable} ranges is wrong — compare the condition at {steps(r.earlierSteps)} with
              the strategy row this path came from.
            </li>
          </ul>
        </>
      ) : (
        <>
          <p>
            At <button type="button" className="segtree-why__step" onClick={() => showStep(r.step)}>step {r.step}</button>,
            every record arriving here has <strong>{r.allowed}</strong>. Branches are tested top to bottom and the first match wins,
            and {r.blockers.map(quote).join(', ')} {r.blockers.length === 1 ? 'comes' : 'come'} before {quote(r.asked)} and
            already {r.blockers.length === 1 ? 'catches' : 'catch'} all of them.
          </p>
          <h4 className="segtree-why__subtitle">How to fix it in SAS Intelligent Decisioning</h4>
          <ul className="segtree-why__fixes">
            <li>If {quote(r.asked)} is meant to win, move it above {quote(r.blockers[0])}.</li>
            <li>If the earlier branch is too wide, narrow its range.</li>
            <li>If {quote(r.asked)} is redundant, delete it.</li>
          </ul>
        </>
      )}
    </div>
  );
}
