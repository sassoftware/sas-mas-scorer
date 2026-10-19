// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import {
  leafExpectedOutputs,
  pathNumber,
  type TreeIndex,
} from '../../utils/segTree/treeIndex';
import {
  explorerLink,
  pathAsExpression,
  pathAsMarkdown,
  pathAsText,
  pathLines,
  sampleRecord,
  type PathView,
} from '../../utils/segTree/formats';
import type { RowResult } from '../../utils/segTree/testRows';
import { Button, MenuButton } from '../common';
import { UnreachableExplanation } from './SegTreeUnreachable';

interface SegTreePathPanelProps {
  index: TreeIndex;
  /** The branch in focus; null for the root. */
  focusId: string | null;
  view: PathView;
  onViewChange: (view: PathView) => void;
  /** The last test run's result for this leaf, if any. */
  result: RowResult | null;
  onTest: (title: string, leafIds: string[]) => void;
  onNavigate: (branchId: string | null) => void;
}

const COPY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h10" />
  </svg>
);

const TEST_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" />
  </svg>
);

export default function SegTreePathPanel({ index, focusId, view, onViewChange, result, onTest, onNavigate }: SegTreePathPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const branch = focusId ? index.branches.get(focusId) ?? null : null;
  const isLeaf = !!branch && !branch.childSplitId;
  const leafStart = branch ? branch.leafStart : 0;
  const leafEnd = branch ? branch.leafEnd : index.leafIds.length;
  const leafCount = leafEnd - leafStart;
  const lines = focusId ? pathLines(index, focusId, view) : [];
  const status = isLeaf ? index.leafStatus.get(focusId!) : undefined;
  const outputs = isLeaf ? leafExpectedOutputs(index, focusId!) : [];

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('Copy failed — the browser blocked clipboard access');
    }
    window.setTimeout(() => setCopied(null), 2500);
  };

  const copyItems = focusId
    ? [
        { id: 'text', label: 'Path as text', description: 'One line, breadcrumb style', onSelect: () => copy('Path copied', pathAsText(index, focusId, view)) },
        { id: 'expr', label: 'SAS condition', description: 'WHERE / DS2 expression for this path', onSelect: () => copy('Condition copied', pathAsExpression(index, focusId)) },
        { id: 'md', label: 'Markdown table', onSelect: () => copy('Markdown copied', pathAsMarkdown(index, focusId, view)) },
        { id: 'json', label: 'Sample input (JSON)', description: 'A record that takes this path', disabled: status === 'shadowed', onSelect: () => copy('Sample input copied', JSON.stringify(sampleRecord(index, focusId), null, 2)) },
        { id: 'link', label: 'Link to this node', onSelect: () => copy('Link copied', explorerLink(index.tree.id, focusId)) },
      ]
    : [
        { id: 'link', label: 'Link to this tree', onSelect: () => copy('Link copied', explorerLink(index.tree.id, null)) },
      ];

  const title = !branch ? 'Whole tree' : isLeaf ? `Path ${pathNumber(index, focusId!)}` : 'Partial path';
  const testTitle = !branch ? 'Whole tree' : isLeaf ? title : `Paths below ${pathAsText(index, focusId!, 'raw')}`;

  return (
    <aside className="segtree-path" aria-labelledby="segtree-path-title">
      <div className="segtree-path__header">
        <h2 id="segtree-path-title" className="segtree-path__title">{title}</h2>
        <div className="segtree-path__view" role="radiogroup" aria-label="Condition view">
          {(['merged', 'raw'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              className={`segtree-toggle${view === v ? ' segtree-toggle--on' : ''}`}
              onClick={() => onViewChange(v)}
              title={v === 'merged' ? 'One condition per variable' : 'Every split, as SID labels it'}
            >
              {v === 'merged' ? 'Merged' : 'Raw steps'}
            </button>
          ))}
        </div>
      </div>

      {status === 'shadowed' && <UnreachableExplanation index={index} leafId={focusId!} onNavigate={onNavigate} />}
      {status === 'manual' && (
        <p className="segtree-path__note" role="note">
          Contains a condition this page cannot interpret; sample values need checking by hand.
        </p>
      )}

      {lines.length > 0 ? (
        <ol className="segtree-path__conditions">
          {lines.map((line, i) => (
            <li key={i} className="segtree-path__condition">{line}</li>
          ))}
        </ol>
      ) : (
        <p className="segtree-path__empty">
          {branch ? 'This branch does not narrow any variable.' : 'Pick a branch or an outcome to see the path that leads to it.'}
        </p>
      )}

      {isLeaf && (
        <div className="segtree-path__outcome">
          <h3 className="segtree-path__subtitle">Outcome</h3>
          <p className="segtree-path__outcome-name">{branch!.outcomeName ?? '(no outcome — outputs keep their incoming values)'}</p>
          {outputs.length > 0 && (
            <dl className="segtree-path__outputs">
              {outputs.map((o) => (
                <div key={o.variable} className="segtree-path__output">
                  <dt>{o.variable}</dt>
                  <dd>{o.value === null ? '(not a literal)' : String(o.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {result && (
        <div className={`segtree-path__result segtree-path__result--${result.status}`} role="status">
          <strong>
            {result.status === 'pass' ? 'Passed in the last test run' : result.status === 'fail' ? 'Failed in the last test run' : 'Scored, nothing to check'}
          </strong>
          {result.mismatches.length > 0 && (
            <ul className="segtree-path__mismatches">
              {result.mismatches.map((m) => (
                <li key={m.variable}>
                  <code>{m.variable}</code>: expected <code>{m.expected}</code>, got <code>{m.actual || '(missing)'}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isLeaf && (
        <p className="segtree-path__subtree">
          {leafCount.toLocaleString()} path{leafCount !== 1 ? 's' : ''} below this point
          {branch ? `, ${branch.outcomeCount.toLocaleString()} outcome${branch.outcomeCount !== 1 ? 's' : ''}` : ''}.
        </p>
      )}

      <div className="segtree-path__actions">
        <MenuButton
          label={<>{COPY_ICON}<span>Copy</span></>}
          items={copyItems}
          triggerClassName="sas-button sas-button--secondary sas-button--small segtree-path__copy"
        />
        <Button
          variant="secondary"
          size="small"
          icon={TEST_ICON}
          disabled={leafCount === 0 || status === 'shadowed'}
          onClick={() => onTest(testTitle, index.leafIds.slice(leafStart, leafEnd))}
        >
          {isLeaf ? 'Test this path…' : `Test ${leafCount.toLocaleString()} paths…`}
        </Button>
      </div>
      <p className="segtree-path__copied" role="status" aria-live="polite">{copied ?? ''}</p>
    </aside>
  );
}
