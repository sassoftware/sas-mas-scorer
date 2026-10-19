// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSegmentationTreeById, type SegmentationTreeDetail } from '../../api/segmentationTrees';
import { buildTreeIndex } from '../../utils/segTree/treeIndex';
import { leafPrefix, nextLeaf } from '../../utils/segTree/leafCounts';
import { autoExpand, expandAll, expandOneLevel, visibleRows, withPathOpen } from '../../utils/segTree/treeView';
import { allPathsCsv, type PathView } from '../../utils/segTree/formats';
import { buildDeepLink } from '../../utils/deepLinks';
import { downloadTextFile } from '../../utils/csv';
import { formatTimestamp } from '../../utils/formatters';
import { Alert, Button, Loading } from '../common';
import FlowDeepLink from '../flows/FlowDeepLink';
import SegTreeBreadcrumb from './SegTreeBreadcrumb';
import SegTreeSplitView, { type ResultPrefixes } from './SegTreeSplitView';
import SegTreePathPanel from './SegTreePathPanel';
import SegTreeOutcomeIndex from './SegTreeOutcomeIndex';
import SegTreeTestDialog, { type TestRunSummary } from './SegTreeTestDialog';
import SegTreeOutline from './SegTreeOutline';
import { UnreachableBanner } from './SegTreeUnreachable';

// The diagram brings in the canvas library; load it only when its tab is opened.
const SegTreeDiagram = lazy(() => import('./SegTreeDiagram'));

interface SegTreeExplorerPageProps {
  treeId: string;
}

const VIEW_PREF = 'segtree:pathView';
const CENTRE_PREF = 'segtree:centreView';

type CentreView = 'split' | 'outline' | 'diagram';
type TreeTab = Exclude<CentreView, 'split'>;
/** Rows each tree view opens to on load before it starts leaving subtrees collapsed. */
const DEFAULT_OPEN: Record<TreeTab, number> = { outline: 150, diagram: 40 };
const CENTRE_VIEWS: { id: CentreView; label: string }[] = [
  { id: 'split', label: 'Split' },
  { id: 'outline', label: 'Outline' },
  { id: 'diagram', label: 'Diagram' },
];

const BACK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

function loadCentre(): CentreView {
  try {
    const v = localStorage.getItem(CENTRE_PREF);
    return v === 'outline' || v === 'diagram' ? v : 'split';
  } catch {
    return 'split';
  }
}

function loadView(): PathView {
  try {
    return localStorage.getItem(VIEW_PREF) === 'raw' ? 'raw' : 'merged';
  } catch {
    return 'merged';
  }
}

export default function SegTreeExplorerPage({ treeId }: SegTreeExplorerPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tree, setTree] = useState<SegmentationTreeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const [view, setView] = useState<PathView>(loadView);
  const [testScope, setTestScope] = useState<{ title: string; leafIds: string[] } | null>(null);
  const [run, setRun] = useState<TestRunSummary | null>(null);
  const [centre, setCentre] = useState<CentreView>(loadCentre);
  // Open branches per tree view. The diagram defaults to far fewer nodes than
  // the outline: a drawn tree gets hard to read much sooner than a list.
  const [expandedBy, setExpandedBy] = useState<Record<TreeTab, Set<string>>>({ outline: new Set(), diagram: new Set() });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setRun(null);
    getSegmentationTreeById(treeId)
      .then((t) => { if (active) setTree(t); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [treeId, reloadToken]);

  const index = useMemo(() => (tree ? buildTreeIndex(tree) : null), [tree]);

  // A large tree starts with its top levels open and the rest collapsed.
  useEffect(() => {
    if (index) setExpandedBy({ outline: autoExpand(index, DEFAULT_OPEN.outline), diagram: autoExpand(index, DEFAULT_OPEN.diagram) });
  }, [index]);

  // The focused branch lives in the URL (?at=<branch id>), so a node can be
  // linked to and the browser's Back button walks back through the jumps.
  const atParam = searchParams.get('at');
  const focusId = index && atParam && index.branches.has(atParam) ? atParam : null;

  const goTo = useCallback((branchId: string | null) => {
    setSearchParams(branchId ? { at: branchId } : {});
  }, [setSearchParams]);

  // The selection is opened up to in the Outline and Diagram, once per
  // selection; after that the user may collapse it again.
  useEffect(() => {
    if (index && focusId) {
      setExpandedBy((prev) => ({
        outline: withPathOpen(index, prev.outline, focusId),
        diagram: withPathOpen(index, prev.diagram, focusId),
      }));
    }
  }, [index, focusId]);

  const treeTab: TreeTab = centre === 'diagram' ? 'diagram' : 'outline';
  const expanded = expandedBy[treeTab];
  const setExpanded = (next: Set<string>) => setExpandedBy((prev) => ({ ...prev, [treeTab]: next }));

  const toggleBranch = useCallback((branchId: string) => {
    setExpandedBy((prev) => {
      const next = new Set(prev[treeTab]);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return { ...prev, [treeTab]: next };
    });
  }, [treeTab]);

  const changeCentre = (v: CentreView) => {
    setCentre(v);
    try { localStorage.setItem(CENTRE_PREF, v); } catch { /* private mode */ }
  };

  const changeView = (v: PathView) => {
    setView(v);
    try { localStorage.setItem(VIEW_PREF, v); } catch { /* private mode */ }
  };

  const shadowedPrefix = useMemo(
    () => (index ? leafPrefix(index, (id) => index.leafStatus.get(id) === 'shadowed') : new Int32Array(1)),
    [index]
  );

  const resultPrefixes = useMemo<ResultPrefixes | null>(() => {
    if (!index || !run) return null;
    const byPath = run.results.byPath;
    return {
      pass: leafPrefix(index, (id) => byPath.get(id)?.status === 'pass'),
      fail: leafPrefix(index, (id) => byPath.get(id)?.status === 'fail'),
    };
  }, [index, run]);

  if (loading) return <Loading message="Loading segmentation tree..." />;

  if (error || !index || !tree) {
    return (
      <div className="segtree">
        <div className="flow-detail__alert">
          <Alert
            variant="error"
            actions={<Button variant="secondary" size="small" onClick={() => setReloadToken((t) => t + 1)}>Retry</Button>}
          >
            {error || 'The segmentation tree could not be loaded.'}
          </Alert>
        </div>
        <Button variant="tertiary" size="small" icon={BACK_ICON} onClick={() => navigate('/segmentation-trees')}>
          Back to list
        </Button>
      </div>
    );
  }

  const focus = focusId ? index.branches.get(focusId)! : null;
  // A leaf has nothing below it, so the centre keeps showing its split.
  const splitId = focus ? focus.childSplitId ?? focus.splitId : index.rootSplitId;
  const activeBranchId = focus && !focus.childSplitId ? focus.id : null;
  const deepLink = buildDeepLink('segmentationTree', tree.id);
  const failedTotal = run?.results.failed ?? 0;
  const focusOrdinal = focus ? (focus.childSplitId ? focus.leafStart - 1 : index.leafOrdinal.get(focus.id)!) : -1;

  const jumpToNext = (test: (id: string) => boolean) => {
    const id = nextLeaf(index, focusOrdinal, test);
    if (id) goTo(id);
  };

  return (
    <div className="segtree">
      <Button variant="tertiary" size="small" icon={BACK_ICON} className="flow-detail__back" onClick={() => navigate('/segmentation-trees')}>
        Back to list
      </Button>

      <header className="segtree__header">
        <div className="segtree__heading">
          <h1 className="segtree__title">{tree.name}</h1>
          {deepLink && <FlowDeepLink url={deepLink.url} label={deepLink.label} showLabel />}
        </div>
        {tree.description && <p className="segtree__desc">{tree.description}</p>}
        <dl className="segtree__stats">
          <div><dt>Version</dt><dd>{tree.majorRevision ?? 0}.{tree.minorRevision ?? 0}</dd></div>
          <div><dt>Splits</dt><dd>{index.splits.size.toLocaleString()}</dd></div>
          <div><dt>Paths</dt><dd>{index.leafIds.length.toLocaleString()}</dd></div>
          <div><dt>Outcomes</dt><dd>{index.outcomes.size.toLocaleString()}</dd></div>
          <div><dt>Modified</dt><dd>{formatTimestamp(tree.modifiedTimeStamp)}</dd></div>
        </dl>
        <div className="segtree__actions">
          <Button variant="secondary" size="small" disabled={index.leafIds.length === 0} onClick={() => setTestScope({ title: 'Whole tree', leafIds: index.leafIds })}>
            Test whole tree…
          </Button>
          <Button
            variant="secondary"
            size="small"
            disabled={index.leafIds.length === 0}
            onClick={() => downloadTextFile(allPathsCsv(index), `${tree.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_paths.csv`)}
          >
            Export paths (CSV)
          </Button>
        </div>
      </header>

      <div className="segtree__notice">
        <UnreachableBanner index={index} onNavigate={goTo} />
      </div>

      {run && (
        <div className="segtree__notice">
          <Alert
            variant={failedTotal > 0 ? 'warning' : 'success'}
            title={`Test "${run.testName}" — ${formatTimestamp(run.ranAt)}`}
            onClose={() => setRun(null)}
            dismissible
            actions={failedTotal > 0 ? (
              <Button variant="secondary" size="small" onClick={() => jumpToNext((id) => run.results.byPath.get(id)?.status === 'fail')}>
                Next failed path
              </Button>
            ) : undefined}
          >
            {run.results.passed.toLocaleString()} passed · {failedTotal.toLocaleString()} failed
            {run.results.unchecked > 0 ? ` · ${run.results.unchecked.toLocaleString()} without expected values` : ''}.
            Output table <code>{run.outputTable}</code>.
          </Alert>
        </div>
      )}

      <SegTreeBreadcrumb index={index} focusId={focusId} onNavigate={goTo} />

      <div className={`segtree__body${centre !== 'split' ? ' segtree__body--wide' : ''}`}>
        <SegTreeOutcomeIndex
          index={index}
          focusId={focusId}
          results={run?.results.byPath ?? null}
          onNavigate={goTo}
          onTest={(title, leafIds) => setTestScope({ title, leafIds })}
        />
        <div className="segtree__centre">
          <div className="segtree-tabs" role="tablist" aria-label="Tree view">
            {CENTRE_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`segtree-tab-${v.id}`}
                aria-selected={centre === v.id}
                aria-controls="segtree-centre-panel"
                tabIndex={centre === v.id ? 0 : -1}
                className={`segtree-tabs__tab${centre === v.id ? ' segtree-tabs__tab--on' : ''}`}
                onClick={() => changeCentre(v.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const i = CENTRE_VIEWS.findIndex((x) => x.id === centre);
                  const next = CENTRE_VIEWS[(i + (e.key === 'ArrowRight' ? 1 : CENTRE_VIEWS.length - 1)) % CENTRE_VIEWS.length];
                  changeCentre(next.id);
                  document.getElementById(`segtree-tab-${next.id}`)?.focus();
                }}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div id="segtree-centre-panel" role="tabpanel" aria-labelledby={`segtree-tab-${centre}`}>
            {centre !== 'split' && splitId && (
              <div className="segtree-treebar">
                <span className="segtree-treebar__count" role="status">
                  Showing {visibleRows(index, expanded).length.toLocaleString()} of {index.branches.size.toLocaleString()} branches
                </span>
                <Button variant="tertiary" size="small" onClick={() => setExpanded(expandOneLevel(index, expanded))}>Open one more level</Button>
                <Button variant="tertiary" size="small" onClick={() => setExpanded(withPathOpen(index, new Set(), focusId))}>Collapse all</Button>
                <Button variant="tertiary" size="small" onClick={() => setExpanded(autoExpand(index, DEFAULT_OPEN[treeTab]))}>Reset</Button>
                {centre === 'outline' && (
                  <Button variant="tertiary" size="small" onClick={() => setExpanded(expandAll(index))}>Expand all</Button>
                )}
              </div>
            )}

            {!splitId && <p className="segtree__empty">This tree has no splits yet.</p>}

            {splitId && centre === 'split' && (
              <SegTreeSplitView
                index={index}
                splitId={splitId}
                activeBranchId={activeBranchId}
                shadowedPrefix={shadowedPrefix}
                results={resultPrefixes}
                onNavigate={goTo}
              />
            )}

            {splitId && centre === 'outline' && (
              <SegTreeOutline
                index={index}
                expanded={expanded}
                onToggle={toggleBranch}
                focusId={focusId}
                shadowedPrefix={shadowedPrefix}
                results={resultPrefixes}
                onNavigate={goTo}
              />
            )}

            {splitId && centre === 'diagram' && (
              <Suspense fallback={<Loading message="Loading diagram..." />}>
                <p className="segtree-treebar__hint">
                  Click a node to select it. A node marked <strong>+ N paths</strong> opens on click; click the selected node again to close it.
                </p>
                <SegTreeDiagram
                  index={index}
                  expanded={expanded}
                  onToggle={toggleBranch}
                  focusId={focusId}
                  shadowedPrefix={shadowedPrefix}
                  results={resultPrefixes}
                  onNavigate={goTo}
                />
              </Suspense>
            )}
          </div>
        </div>
        <SegTreePathPanel
          index={index}
          focusId={focusId}
          view={view}
          onViewChange={changeView}
          result={focusId ? run?.results.byPath.get(focusId) ?? null : null}
          onTest={(title, leafIds) => setTestScope({ title, leafIds })}
          onNavigate={goTo}
        />
      </div>

      {testScope && (
        <SegTreeTestDialog
          index={index}
          title={testScope.title}
          leafIds={testScope.leafIds}
          onClose={() => setTestScope(null)}
          onResults={setRun}
        />
      )}
    </div>
  );
}
