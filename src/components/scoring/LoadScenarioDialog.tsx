// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import axios from 'axios';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Loading } from '../common/Loading';
import { Modal } from '../common/Modal';
import { ProgressBar } from '../common/ProgressBar';
import { SearchInput } from '../common/SearchInput';
import {
  listDecisionScenarios,
  getScoreDefinition,
  ScoreDefinitionSummary,
} from '../../api/scoreDefinitions';
import { DecisionSignatureVariable } from '../../api/modules';
import { buildStepInput, executeStep } from '../../api';
import { Step } from '../../types';
import {
  OutputCheck,
  OutputChecks,
  checkOutputs,
  formatCheckValue,
} from '../../utils/expectedValues';
import { LoadedScenario, scenarioFromMappings, scenarioMismatch } from './scenarioMapping';
import { CheckBadge } from './CheckBadge';
import { ComparisonRule } from './ComparisonRule';

/** A scenario picked in the dialog, ready for the form. */
export interface ScenarioSelection extends LoadedScenario {
  id: string;
  name: string;
}

interface LoadScenarioDialogProps {
  sourceURI: string;
  /** The MAS module and step the scenarios are run against by "Run all" */
  moduleId: string;
  step: Step;
  /** Decision signature, resolved once by ScorePanel and passed down. */
  signature: DecisionSignatureVariable[];
  /** Fill the form with a scenario (replacing it); `run` also executes it. */
  onLoad: (scenario: ScenarioSelection, options?: { run?: boolean }) => void;
  onClose: () => void;
}

type RunStatus = 'pass' | 'fail' | 'none' | 'error';

interface ScenarioRun {
  scenario: ScoreDefinitionSummary;
  status: RunStatus;
  loaded?: LoadedScenario;
  checks?: OutputChecks;
  error?: string;
}

type ResultFilter = 'all' | 'fail' | 'pass' | 'none' | 'error';

// Scenarios scored at once by "Run all": enough to finish a few hundred in
// reasonable time without crowding the MAS server the user is working on.
const RUN_CONCURRENCY = 3;

const STATUS_LABEL: Record<RunStatus, string> = {
  pass: 'Matches',
  fail: 'Differs',
  none: 'Not checked',
  error: 'Could not run',
};

const matches = (s: ScoreDefinitionSummary, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.description, s.createdBy].some(v => v?.toLowerCase().includes(q));
};

export const LoadScenarioDialog: React.FC<LoadScenarioDialogProps> = ({
  sourceURI,
  moduleId,
  step,
  signature,
  onLoad,
  onClose,
}) => {
  const uid = useId();
  const [scenarios, setScenarios] = useState<ScoreDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // "Run all" state
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<ScenarioRun[] | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const stopRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const [focusFirstFailure, setFocusFirstFailure] = useState(false);

  // Extract decision flow ID from sourceURI
  const flowId = sourceURI.match(/\/decisions\/flows\/([a-f0-9-]+)/)?.[1] ?? '';


  // Load the scenario list on mount; the signature arrives as a prop (ScorePanel
  // already holds it) instead of being refetched here.
  useEffect(() => {
    if (!flowId) {
      setError('Could not determine decision flow ID');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const scenarioList = await listDecisionScenarios(flowId);
        if (cancelled) return;
        setScenarios(scenarioList);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load scenarios');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  // Closing the dialog mid-run stops the run and the requests in flight
  useEffect(() => () => {
    stopRef.current = true;
    controllerRef.current?.abort();
  }, []);

  const shown = useMemo(() => scenarios.filter(s => matches(s, query)), [scenarios, query]);

  const loadScenario = useCallback(async (scenario: ScoreDefinitionSummary): Promise<LoadedScenario> => {
    const detail = await getScoreDefinition(scenario.id);
    return scenarioFromMappings(detail.mappings ?? [], signature, step.inputs ?? [], step.outputs ?? []);
  }, [signature, step]);

  const handleSelectScenario = useCallback(async (scenario: ScoreDefinitionSummary) => {
    setLoadingDetail(true);
    setError(null);

    try {
      const loaded = await loadScenario(scenario);
      onLoad({ id: scenario.id, name: scenario.name, ...loaded });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenario details');
    } finally {
      setLoadingDetail(false);
    }
  }, [loadScenario, onLoad, onClose]);

  // One scenario: read it, score its inputs, check the outputs it expects
  const runOne = useCallback(async (scenario: ScoreDefinitionSummary, signal: AbortSignal): Promise<ScenarioRun | null> => {
    let loaded: LoadedScenario | undefined;
    try {
      loaded = await loadScenario(scenario);
      // Scoring without some of its inputs is not the run the scenario describes
      const mismatch = scenarioMismatch(loaded, step.id);
      if (mismatch) return { scenario, status: 'error', loaded, error: `Not run. ${mismatch}` };
      const output = await executeStep(moduleId, step.id, buildStepInput(step, loaded.values), { signal });
      const checks = checkOutputs(output.outputs, loaded.expected);
      const status: RunStatus = checks.failed > 0 ? 'fail' : checks.passed > 0 ? 'pass' : 'none';
      return { scenario, status, loaded, checks };
    } catch (err) {
      if (axios.isCancel(err)) return null;
      return {
        scenario,
        status: 'error',
        loaded,
        error: err instanceof Error ? err.message : 'Failed to run the scenario',
      };
    }
  }, [loadScenario, moduleId, step]);

  const handleRunAll = useCallback(async () => {
    const list = shown;
    if (list.length === 0) return;
    stopRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError(null);
    setRuns(null);
    setResultFilter('all');
    setExpanded(new Set());
    setProgress({ done: 0, total: list.length });

    const results: (ScenarioRun | undefined)[] = new Array(list.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (!stopRef.current && next < list.length) {
        const slot = next++;
        const run = await runOne(list[slot], controller.signal);
        if (!run) return;
        results[slot] = run;
        done++;
        setProgress({ done, total: list.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, list.length) }, worker));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      // An unmount aborts the run; there is nothing left to show it in
      if (!controller.signal.aborted) {
        setRuns(results.filter((r): r is ScenarioRun => r !== undefined));
        setRunning(false);
      }
    }
  }, [shown, runOne]);

  const handleStop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const handleClose = useCallback(() => {
    if (loadingDetail) return;
    stopRef.current = true;
    controllerRef.current?.abort();
    onClose();
  }, [loadingDetail, onClose]);

  const counts = useMemo(() => {
    const c: Record<RunStatus, number> = { pass: 0, fail: 0, none: 0, error: 0 };
    for (const r of runs ?? []) c[r.status]++;
    return c;
  }, [runs]);

  const visibleRuns = useMemo(
    () => (runs ?? []).filter(r => resultFilter === 'all' || r.status === resultFilter),
    [runs, resultFilter]
  );

  // "Go to first failure": show the failures, open the first one and focus it
  useEffect(() => {
    if (!focusFirstFailure) return;
    setFocusFirstFailure(false);
    const el = document.getElementById(`${uid}-first-failure`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [focusFirstFailure, uid]);

  const goToFirstFailure = () => {
    const first = runs?.find(r => r.status === 'fail' || r.status === 'error');
    if (!first) return;
    setResultFilter(counts.fail > 0 ? 'fail' : 'error');
    setExpanded(prev => new Set(prev).add(first.scenario.id));
    setFocusFirstFailure(true);
  };

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadRun = (run: ScenarioRun, execute: boolean) => {
    if (!run.loaded) return;
    onLoad({ id: run.scenario.id, name: run.scenario.name, ...run.loaded }, { run: execute });
    onClose();
  };

  const renderMismatches = (checks: OutputChecks) => {
    const failed: OutputCheck[] = Array.from(checks.byName.values()).filter(c => c.status === 'fail');
    if (failed.length === 0) return null;
    return (
      <table className="sas-table sas-table--compact load-scenario__mismatches">
        <caption className="sr-only">Outputs that differ from the expected values</caption>
        <thead className="sas-table__head">
          <tr>
            <th className="sas-table__th" scope="col">Output</th>
            <th className="sas-table__th" scope="col">Expected</th>
            <th className="sas-table__th" scope="col">Actual</th>
          </tr>
        </thead>
        <tbody>
          {failed.map(c => (
            <tr className="sas-table__row" key={c.name}>
              <td className="sas-table__td">{c.name}</td>
              <td className="sas-table__td load-scenario__value">{formatCheckValue(c.expected)}</td>
              <td className="sas-table__td load-scenario__value">
                {c.returned ? (formatCheckValue(c.actual) || 'missing') : 'not returned'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const resultChips: { value: ResultFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: runs?.length ?? 0 },
    { value: 'fail', label: 'Differs', count: counts.fail },
    { value: 'error', label: 'Could not run', count: counts.error },
    { value: 'pass', label: 'Matches', count: counts.pass },
    { value: 'none', label: 'Not checked', count: counts.none },
  ];

  let firstFailureAssigned = false;

  const runSummary = runs && (
    <>
      {runs.length < progress.total ? `Stopped after ${runs.length} of ${progress.total} scenarios: ` : `${runs.length} scenario${runs.length === 1 ? '' : 's'} run: `}
      {counts.pass} match the expected values, {counts.fail} differ
      {counts.none > 0 ? `, ${counts.none} not checked (no expected values)` : ''}
      {counts.error > 0 ? `, ${counts.error} could not run` : ''}.
    </>
  );

  return (
    <Modal
      title="Load Scenario"
      onClose={handleClose}
      size={runs || running ? 'large' : 'medium'}
      closeOnBackdropClick={!loadingDetail && !running}
      footer={
        <>
          {runs && !running && (
            <Button variant="secondary" onClick={() => setRuns(null)}>
              Back to the list
            </Button>
          )}
          <Button variant="tertiary" onClick={handleClose} disabled={loadingDetail}>
            {runs ? 'Close' : 'Cancel'}
          </Button>
        </>
      }
    >
      <div className="save-scenario-dialog__fields">
        {loading && <Loading message="Loading scenarios..." />}

        {error && <Alert variant="error">{error}</Alert>}

        {!loading && scenarios.length === 0 && !error && (
          <div className="load-scenario__empty">
            <p>No scenarios found for this decision.</p>
            <p className="load-scenario__empty-hint">
              Scenarios can be created from the "Save as Scenario" button after executing a score,
              or directly in SAS Intelligent Decisioning.
            </p>
          </div>
        )}

        {/* Run all: progress, then the results */}
        {running && (
          <div className="load-scenario__run">
            <ProgressBar
              phase="Running scenarios"
              value={progress.done}
              max={progress.total}
              count={`${progress.done} of ${progress.total}`}
              label="Running scenarios"
              message="Each scenario's inputs are scored by the published module and its outputs compared with the saved expected values."
            />
            <Button variant="danger" size="small" onClick={handleStop}>
              Stop
            </Button>
          </div>
        )}

        {runs && !running && (
          <section className="load-scenario__results" aria-labelledby={`${uid}-results`}>
            <h4 className="load-scenario__results-title" id={`${uid}-results`}>Results</h4>
            <div className="load-scenario__results-summary" role="status" aria-live="polite">
              <CheckBadge
                status={counts.fail > 0 ? 'fail' : counts.error > 0 ? 'error' : counts.pass > 0 ? 'pass' : 'none'}
                size="medium"
                label={counts.fail > 0 ? 'Some differ' : counts.error > 0 ? 'Errors' : counts.pass > 0 ? 'All match' : 'Nothing checked'}
              />
              <span>{runSummary}</span>
            </div>
            <ComparisonRule />
            <div className="load-scenario__results-toolbar">
              <div className="batch-results__chips" role="group" aria-label="Show scenarios by result">
                {resultChips.filter(c => c.value === 'all' || c.count > 0).map(chip => (
                  <button
                    key={chip.value}
                    type="button"
                    className={`batch-results__chip${resultFilter === chip.value ? ' batch-results__chip--active' : ''}`}
                    aria-pressed={resultFilter === chip.value}
                    onClick={() => setResultFilter(chip.value)}
                  >
                    {chip.label} ({chip.count})
                  </button>
                ))}
              </div>
              {(counts.fail > 0 || counts.error > 0) && (
                <Button variant="secondary" size="small" onClick={goToFirstFailure}>
                  Go to first difference
                </Button>
              )}
            </div>
            <ul className="load-scenario__run-list">
              {visibleRuns.map(run => {
                const isOpen = expanded.has(run.scenario.id);
                const detailsId = `${uid}-run-${run.scenario.id}`;
                const failing = run.status === 'fail' || run.status === 'error';
                const assignRef = failing && !firstFailureAssigned;
                if (assignRef) firstFailureAssigned = true;
                return (
                  <li key={run.scenario.id} className={`load-scenario__run-item load-scenario__run-item--${run.status}`}>
                    <div className="load-scenario__run-row">
                      <CheckBadge status={run.status} label={STATUS_LABEL[run.status]} />
                      <span className="load-scenario__run-name">{run.scenario.name}</span>
                      {run.checks && (
                        <span className="load-scenario__run-counts">
                          {run.checks.passed} match, {run.checks.failed} differ
                        </span>
                      )}
                      <span className="load-scenario__run-actions">
                        {failing && (
                          <Button
                            id={assignRef ? `${uid}-first-failure` : undefined}
                            variant="tertiary"
                            size="small"
                            aria-expanded={isOpen}
                            aria-controls={detailsId}
                            onClick={() => toggleExpanded(run.scenario.id)}
                          >
                            {isOpen ? 'Hide details' : 'Details'}
                          </Button>
                        )}
                        {run.loaded && (
                          <Button
                            variant="tertiary"
                            size="small"
                            onClick={() => loadRun(run, true)}
                            aria-label={`Load and run ${run.scenario.name}`}
                          >
                            Load and run
                          </Button>
                        )}
                      </span>
                    </div>
                    {failing && isOpen && (
                      <div className="load-scenario__run-details" id={detailsId}>
                        {run.error && <p className="load-scenario__run-error">{run.error}</p>}
                        {run.checks && renderMismatches(run.checks)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!loading && scenarios.length > 0 && !running && !runs && (
          <>
            <div className="load-scenario__toolbar">
              <SearchInput
                aria-label="Search scenarios"
                placeholder="Search by name, description or author"
                value={query}
                onChange={setQuery}
                disabled={loadingDetail}
                className="load-scenario__search"
              />
              <Button
                variant="secondary"
                size="small"
                onClick={handleRunAll}
                disabled={loadingDetail || shown.length === 0}
                title="Score every scenario listed and compare its outputs with the saved expected values"
              >
                {query.trim() ? `Run ${shown.length} shown` : `Run all scenarios (${scenarios.length})`}
              </Button>
            </div>
            <p className="load-scenario__count" role="status" aria-live="polite">
              {query.trim()
                ? `${shown.length} of ${scenarios.length} scenarios match`
                : `${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}`}
              . Loading a scenario replaces every input in the form.
            </p>
            {shown.length === 0 ? (
              <p className="load-scenario__empty">No scenarios match &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <div className="load-scenario__list">
                {shown.map(scenario => (
                  <button
                    key={scenario.id}
                    type="button"
                    className="load-scenario__item"
                    onClick={() => handleSelectScenario(scenario)}
                    disabled={loadingDetail}
                  >
                    <div className="load-scenario__item-main">
                      <div className="load-scenario__item-name">{scenario.name}</div>
                      {scenario.description && (
                        <div className="load-scenario__item-desc">{scenario.description}</div>
                      )}
                    </div>
                    <div className="load-scenario__item-meta">
                      <Badge variant="info" size="small">Scenario</Badge>
                      <span className="load-scenario__item-author">{scenario.createdBy}</span>
                      <span className="load-scenario__item-date">
                        {new Date(scenario.modifiedTimeStamp).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {loadingDetail && (
          <div className="load-scenario__loading-overlay">
            <Loading message="Loading scenario values..." />
          </div>
        )}
      </div>
    </Modal>
  );
};
