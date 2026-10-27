// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Loading, Modal, ProgressBar } from '../common';
import FlowDeepLink from '../flows/FlowDeepLink';
import {
  latestTestExecutions,
  listTreeRevisionLabels,
  listTreeTests,
  retargetTreeTest,
  type TreeTestDefinition,
  type TreeTestList,
} from '../../api/treeTests';
import { buildDeepLink } from '../../utils/deepLinks';
import { formatTimestamp } from '../../utils/formatters';
import type { TreeIndex } from '../../utils/segTree/treeIndex';
import { casTableName, stalePathIds } from '../../utils/segTree/testRows';
import { readTestResults, runFailureText, runScoreDefinition, type RunFailure } from './runTreeTest';
import SegTreeRunFailure from './SegTreeRunFailure';
import type { TestRunSummary } from './SegTreeTestDialog';

interface SegTreeTestsDialogProps {
  index: TreeIndex;
  onClose: () => void;
  /** Results to show on the tree (a re-run, or the last results of a saved test). */
  onResults: (summary: TestRunSummary) => void;
  /** Select the first failed path on the tree. */
  onShowFailure: () => void;
}

/** What the last action on a test came to. */
type Outcome =
  | { kind: 'results'; testId: string; summary: TestRunSummary; stale: number; note?: string }
  | { kind: 'info'; testId: string; text: string }
  | { kind: 'error'; testId: string; text: string; failure?: RunFailure };

const SCENARIOS_SHOWN = 100;

const message = (err: unknown, fallback: string) =>
  (err as { message?: string })?.message ?? fallback;

/**
 * The tests and scenarios saved on this tree in SAS Intelligent Decisioning.
 * A table test can be run again or have its last results shown on the tree;
 * each test says which tree revision it is pinned to, since a test scores
 * the revision its definition names, not necessarily the one on screen.
 */
export default function SegTreeTestsDialog({ index, onClose, onResults, onShowFailure }: SegTreeTestsDialogProps) {
  const tree = index.tree;
  const currentRevision = tree.revisionId ?? null;
  const currentUri = tree.revisionUri ?? (tree.revisionId ? `/decisions/segmentationTrees/${tree.id}/revisions/${tree.revisionId}` : null);

  const [list, setList] = useState<TreeTestList | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showAllScenarios, setShowAllScenarios] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [phase, setPhase] = useState('');
  const [confirmMove, setConfirmMove] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([listTreeTests(tree.id), listTreeRevisionLabels(tree.id)])
      .then(([tests, revs]) => {
        if (!active) return;
        setList(tests);
        setLabels(revs);
      })
      .catch((err) => { if (active) setLoadError(message(err, 'The tests could not be listed.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tree.id, reload]);

  const currentText = () => {
    const label = currentRevision ? labels.get(currentRevision) : undefined;
    return label ? `Revision ${label} (current)` : 'Current revision';
  };

  const revisionText = (t: TreeTestDefinition): { text: string; older: boolean } => {
    if (!t.detailLoaded) return { text: 'Revision not read', older: false };
    if (!t.revisionId) return { text: 'No revision named', older: false };
    const label = labels.get(t.revisionId);
    if (t.revisionId === currentRevision) return { text: currentText(), older: false };
    return { text: label ? `Older revision ${label}` : `Other revision (${t.revisionId.slice(0, 8)}…)`, older: true };
  };

  const show = (test: TreeTestDefinition, summary: TestRunSummary, note?: string) => {
    onResults(summary);
    setOutcome({ kind: 'results', testId: test.id, summary, stale: stalePathIds(index, summary.results).length, note });
  };

  const start = (test: TreeTestDefinition) => {
    stopRef.current = false;
    setBusyId(test.id);
    setOutcome(null);
    setConfirmMove(null);
  };

  const showLast = async (test: TreeTestDefinition) => {
    start(test);
    const rev = revisionText(test);
    let step = 'Finding the last run';
    try {
      setPhase(step);
      const { latest, latestCompleted } = await latestTestExecutions(test.id);
      if (stopRef.current) return;
      if (!latestCompleted) {
        setOutcome({
          kind: 'info',
          testId: test.id,
          text: latest
            ? `None of the recent runs completed (the newest ended as "${latest.state}"). Run the test again to get results.`
            : 'This test has not been run yet. Run it to get results.',
        });
        return;
      }
      const out = latestCompleted.outputTable!;
      step = `Reading ${out.libraryName}.${out.tableName}`;
      setPhase(step);
      let results;
      try {
        results = await readTestResults(out);
      } catch (err) {
        setOutcome({
          kind: 'info',
          testId: test.id,
          text: `The output table ${out.libraryName}.${out.tableName} of the run on ${formatTimestamp(latestCompleted.creationTimeStamp)} could not be read (${message(err, 'unknown error')}). It may have been dropped, for example when its CAS session ended. Run the test again to get fresh results.`,
        });
        return;
      }
      if (stopRef.current) return;
      const note = latest && latest.id !== latestCompleted.id
        ? `The newest run ended as "${latest.state}"; these are the results of the last run that completed.`
        : undefined;
      show(test, {
        testName: test.name,
        ranAt: latestCompleted.creationTimeStamp ?? latestCompleted.modifiedTimeStamp ?? new Date().toISOString(),
        outputTable: `${out.libraryName}.${out.tableName}`,
        results,
        revisionNote: `Test pinned to ${rev.text.charAt(0).toLowerCase()}${rev.text.slice(1)}`,
      }, note);
    } catch (err) {
      setOutcome({ kind: 'error', testId: test.id, text: `${step} failed: ${message(err, 'unknown error')}` });
    } finally {
      setBusyId(null);
      setPhase('');
    }
  };

  const runAgain = async (test: TreeTestDefinition, moveToCurrent: boolean) => {
    start(test);
    let step = 'Running the test';
    try {
      if (moveToCurrent && currentUri) {
        step = 'Moving the test to the current revision';
        setPhase(step);
        await retargetTreeTest(test.id, currentUri, tree.name);
        setList((prev) => prev && {
          ...prev,
          tests: prev.tests.map((t) => (t.id === test.id ? { ...t, targetUri: currentUri, revisionId: currentRevision } : t)),
        });
      }
      const rev = moveToCurrent ? { text: currentText() } : revisionText(test);
      step = 'Running the test';
      const result = await runScoreDefinition(test.id, `Execution for ${test.name}`, () => stopRef.current, (p) => { step = p; setPhase(p); });
      if (result.kind === 'stopped') return;
      if (result.kind === 'failed') {
        setOutcome({ kind: 'error', testId: test.id, text: runFailureText(result.failure), failure: result.failure });
        return;
      }
      step = 'Reading the results';
      setPhase(step);
      const out = result.execution.outputTable;
      const results = await readTestResults(out);
      if (stopRef.current) return;
      show(test, {
        testName: test.name,
        ranAt: new Date().toISOString(),
        outputTable: `${out.libraryName}.${out.tableName}`,
        results,
        revisionNote: `Ran against ${rev.text.charAt(0).toLowerCase()}${rev.text.slice(1)}`,
      });
    } catch (err) {
      setOutcome({ kind: 'error', testId: test.id, text: `${step} failed: ${message(err, 'unknown error')}` });
    } finally {
      setBusyId(null);
      setPhase('');
    }
  };

  const handleClose = useCallback(() => {
    // Closing stops waiting; a run already started continues in SAS Viya.
    stopRef.current = true;
    onClose();
  }, [onClose]);

  const treeLink = buildDeepLink('segmentationTree', tree.id);
  const done = outcome?.kind === 'results' ? outcome : null;

  const footer = (
    <>
      {done && done.summary.results.failed > 0 && (
        <Button variant="secondary" onClick={() => { onClose(); onShowFailure(); }}>Close and show failed paths</Button>
      )}
      <Button variant={done ? 'primary' : 'tertiary'} onClick={handleClose}>
        {done ? 'Close and view on the tree' : busyId ? 'Close (the run continues in SAS Viya)' : 'Close'}
      </Button>
    </>
  );

  const renderOutcome = (test: TreeTestDefinition) => {
    if (busyId === test.id) {
      return <ProgressBar phase={phase} indeterminate label={`Working on ${test.name}`} />;
    }
    if (!outcome || outcome.testId !== test.id) return null;
    if (outcome.kind === 'info') return <Alert variant="info">{outcome.text}</Alert>;
    if (outcome.kind === 'error') {
      return (
        <>
          <Alert variant="error">{outcome.text}</Alert>
          {outcome.failure && <SegTreeRunFailure failure={outcome.failure} treeId={tree.id} logFileName={casTableName(test.name)} />}
        </>
      );
    }
    const r = outcome.summary.results;
    return (
      <Alert variant={r.failed > 0 || outcome.stale > 0 ? 'warning' : 'success'} title={r.failed > 0 ? 'Some paths failed' : 'All checked paths passed'}>
        {r.passed.toLocaleString()} passed · {r.failed.toLocaleString()} failed
        {r.unchecked > 0 ? ` · ${r.unchecked.toLocaleString()} without expected values` : ''}. {outcome.summary.revisionNote}.
        {outcome.stale > 0 && ` ${outcome.stale.toLocaleString()} row${outcome.stale !== 1 ? 's refer' : ' refers'} to paths that are not in this revision of the tree (removed, or split further), so they are not shown on it.`}
        {outcome.note ? ` ${outcome.note}` : ''} The results are now shown on the tree.
      </Alert>
    );
  };

  const scenarios = list?.scenarios ?? [];
  const shownScenarios = showAllScenarios ? scenarios : scenarios.slice(0, SCENARIOS_SHOWN);

  return (
    <Modal title={`Tests on ${tree.name}`} size="large" onClose={handleClose} closeOnBackdropClick={!busyId} footer={footer} className="segtree-tests-dialog">
      {loading && <Loading message="Looking for tests on this tree..." />}
      {!loading && loadError && (
        <Alert
          variant="error"
          actions={<Button variant="secondary" size="small" onClick={() => setReload((n) => n + 1)}>Retry</Button>}
        >
          {loadError}
        </Alert>
      )}
      {!loading && list && (
        <div className="segtree-tests">
          <p className="segtree-tests__intro">
            Each test is pinned to the tree revision it was saved for, and a run scores that revision.
            To check the tree as it is now, move an older test to the current revision before running it.
            Rows are matched to paths by their <code>_pathId</code>; rows whose path is not in this revision are counted, not shown.
          </p>

          <section aria-labelledby="segtree-tests-table-title">
            <h3 id="segtree-tests-table-title" className="segtree-tests__title">
              Table tests <span className="segtree-outcomes__count">{list.tests.length.toLocaleString()}</span>
            </h3>
            {list.tests.length === 0 && (
              <p className="segtree-tests__empty">No table tests on this tree. Use Test whole tree… or a path's Test button to create one.</p>
            )}
            <ul className="segtree-tests__list">
              {list.tests.map((t) => {
                const rev = revisionText(t);
                const table = t.inputTable?.tableName ? `${t.inputTable.libraryName ?? ''}.${t.inputTable.tableName}` : null;
                const disabled = busyId !== null;
                return (
                  <li key={t.id} className="segtree-tests__item">
                    <div className="segtree-tests__main">
                      <span className="segtree-tests__name">{t.name}</span>
                      <span className={`segtree-chip ${rev.older ? 'segtree-chip--warn' : 'segtree-chip--neutral'}`}>{rev.text}</span>
                      <span className="segtree-tests__meta">
                        {table ? `Reads ${table}` : 'Input table not recorded'}
                        {t.modifiedTimeStamp || t.creationTimeStamp ? ` · saved ${formatTimestamp(t.modifiedTimeStamp ?? t.creationTimeStamp)}` : ''}
                        {t.createdBy ? ` by ${t.createdBy}` : ''}
                      </span>
                    </div>
                    <div className="segtree-tests__actions">
                      <Button variant="secondary" size="small" disabled={disabled} onClick={() => void showLast(t)}>Show last results</Button>
                      {rev.older && currentUri ? (
                        <Button variant="secondary" size="small" disabled={disabled} aria-expanded={confirmMove === t.id} onClick={() => setConfirmMove(confirmMove === t.id ? null : t.id)}>
                          Run on the current revision…
                        </Button>
                      ) : (
                        <Button variant="secondary" size="small" disabled={disabled} onClick={() => void runAgain(t, false)}>Run again</Button>
                      )}
                    </div>
                    {confirmMove === t.id && (
                      <div className="segtree-tests__confirm" role="group" aria-label={`Move ${t.name} to the current revision`}>
                        <p>
                          Move and run changes the saved test in SAS Intelligent Decisioning so that it tests the current
                          revision{labels.get(currentRevision ?? '') ? ` (${labels.get(currentRevision ?? '')})` : ''} instead
                          of {rev.text.replace(/^Older revision/, 'revision').replace(/^Other revision/, 'the revision')}, then runs it.
                          Its rows and expected values stay as they were saved.
                        </p>
                        <div className="segtree-tests__actions">
                          <Button variant="primary" size="small" onClick={() => void runAgain(t, true)}>Move and run</Button>
                          <Button variant="secondary" size="small" onClick={() => void runAgain(t, false)}>Run on its own revision</Button>
                          <Button variant="tertiary" size="small" onClick={() => setConfirmMove(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                    <div className="segtree-tests__outcome" aria-live="polite">{renderOutcome(t)}</div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="segtree-tests-scen-title">
            <h3 id="segtree-tests-scen-title" className="segtree-tests__title">
              Scenarios <span className="segtree-outcomes__count">{scenarios.length.toLocaleString()}</span>
            </h3>
            {scenarios.length === 0 ? (
              <p className="segtree-tests__empty">No scenarios on this tree.</p>
            ) : (
              <p className="segtree-tests__note">
                Scenarios keep their expected values in the scenario, not in an output table, so they are run and checked
                on the tree's Scenarios tab in SAS Intelligent Decisioning.
                {treeLink && <> <FlowDeepLink url={treeLink.url} label="Open the tree in SAS Intelligent Decisioning" showLabel /></>}
              </p>
            )}
            <ul className="segtree-tests__list segtree-tests__list--compact">
              {shownScenarios.map((s) => {
                const rev = revisionText(s);
                return (
                  <li key={s.id} className="segtree-tests__item segtree-tests__item--compact">
                    <span className="segtree-tests__name">{s.name}</span>
                    <span className={`segtree-chip ${rev.older ? 'segtree-chip--warn' : 'segtree-chip--neutral'}`}>{rev.text}</span>
                  </li>
                );
              })}
            </ul>
            {scenarios.length > shownScenarios.length && (
              <Button variant="tertiary" size="small" onClick={() => setShowAllScenarios(true)}>
                Show all {scenarios.length.toLocaleString()} scenarios
              </Button>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
