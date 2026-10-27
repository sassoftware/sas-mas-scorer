// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Card, CardHeader, CardBody } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { SearchInput } from '../common/SearchInput';
import { ProgressBar } from '../common/ProgressBar';
import { Pagination } from '../common/Pagination';
import { PageHeader } from '../layout/Layout';
import { getSasViyaUrl } from '../../config';
import { registerViewCache } from '../../utils/viewCaches';
import { saveTextFile } from '../../utils/download';
import { useDebouncedUrlText, useListUrlParams } from '../../utils/listUrlState';
import {
  collectCoverage,
  collectionGaps,
  COVERAGE_TOTAL_STEPS,
  describeCollectionStatus,
  describeLastRun,
  describeTestChanges,
  generateCoverageCSV,
  generateCoverageMarkdown,
  getContentTypeLabel,
  getDeepLink,
  isAtRisk,
  shortId,
  testHealthLabel,
  testsNotCollected,
  type CoverageRunResult,
  type RunScanStatus,
} from '../../api/coverage';
import { masModuleRoute } from '../../api/modelPublish';
import { AssetTestHealth, ContentType, CollectionProgress, TestScenarioInfo } from '../../types/coverage';
import { ScoreIcon, useDecisionMasIndex } from './DecisionScoreAction';

type FilterType = 'all' | ContentType;
type CoverageFilter = 'all' | 'covered' | 'uncovered' | 'at-risk';

const TYPE_FILTERS = ['all', 'decision', 'businessRule', 'codeFile', 'model', 'treatment', 'segmentationTree'] as const satisfies readonly FilterType[];
const COVERAGE_FILTERS = ['all', 'covered', 'uncovered', 'at-risk'] as const satisfies readonly CoverageFilter[];
/** URL defaults for the detail table; left out of the URL when unchanged. */
const LIST_DEFAULTS = { q: '', type: 'all', coverage: 'all' };
type SortField = 'name' | 'contentType' | 'testScenarioCount' | 'modifiedTimestamp';

/** Rows rendered per page; filtering, sorting and the exports still cover every asset. */
const PAGE_SIZE = 50;

/** One collator for every comparison — building Intl state per compare is what made sorting slow. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// --- The analysis run, kept outside the component ---------------------------
//
// A run takes minutes, so it lives at module level: leaving the page does not
// stop it or lose its progress, and coming back re-attaches to it (no second,
// duplicate run). `result` is the last good result; it stays on screen while
// a re-run is in progress and after a re-run fails or is cancelled.

interface CoverageRunState {
  running: boolean;
  progress: CollectionProgress | null;
  result: CoverageRunResult | null;
  error: string | null;
  /** Set when the user cancelled the last run (cleared by the next run). */
  cancelled: boolean;
}

const IDLE_RUN: CoverageRunState = {
  running: false,
  progress: null,
  result: null,
  error: null,
  cancelled: false,
};

let runState: CoverageRunState = IDLE_RUN;
// Bumped by every start, cancel and clear; a run whose id is no longer
// current writes nothing (a cancelled run, or one from before a logout).
let runId = 0;
let runController: AbortController | null = null;
const runListeners = new Set<() => void>();

const setRunState = (patch: Partial<CoverageRunState>): void => {
  runState = { ...runState, ...patch };
  runListeners.forEach(listener => listener());
};

const subscribeRun = (listener: () => void): (() => void) => {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
};

const getRunState = (): CoverageRunState => runState;

const startCoverageRun = async (): Promise<void> => {
  if (runState.running) return;
  const id = ++runId;
  const controller = new AbortController();
  runController = controller;
  setRunState({
    running: true,
    error: null,
    cancelled: false,
    progress: {
      phase: 'starting',
      currentStep: 0,
      totalSteps: COVERAGE_TOTAL_STEPS,
      message: 'Starting collection...',
      itemsCollected: 0,
    },
  });
  try {
    const result = await collectCoverage(
      (p) => {
        if (id === runId) setRunState({ progress: { ...p } });
      },
      { signal: controller.signal },
    );
    if (id !== runId) return;
    setRunState({ running: false, progress: null, result, error: null });
  } catch (err) {
    if (id !== runId) return;
    // The previous result (if any) stays; the error is shown above it.
    setRunState({
      running: false,
      progress: null,
      error: err instanceof Error ? err.message : 'Failed to collect coverage data',
    });
  } finally {
    if (runController === controller) runController = null;
  }
};

/** Stop the run in flight; its walks end at their next page. */
const cancelCoverageRun = (): void => {
  if (!runState.running) return;
  runId += 1;
  runController?.abort();
  runController = null;
  setRunState({ running: false, progress: null, cancelled: true });
};

export const clearCoverageAnalysisCache = (): void => {
  // A run started for the previous session must not keep walking the old
  // server or write its result after the switch.
  runId += 1;
  runController?.abort();
  runController = null;
  setRunState(IDLE_RUN);
};

// The shell clears this through the registry, so Header/App never import the
// coverage view (which would pull it into the entry chunk).
registerViewCache('coverage', clearCoverageAnalysisCache);

export const CoverageAnalysis: React.FC = () => {
  const { running: loading, progress, result, error, cancelled } = useSyncExternalStore(
    subscribeRun,
    getRunState,
  );
  const setError = (next: null) => setRunState({ error: next });

  // Detail table state. Search and the two filters live in the URL, so Back,
  // a reload or a shared link shows the same rows.
  const [listParams, updateListParams] = useListUrlParams('coverage', LIST_DEFAULTS);
  const typeFilter: FilterType = (TYPE_FILTERS as readonly string[]).includes(listParams.type)
    ? (listParams.type as FilterType)
    : 'all';
  const coverageFilter: CoverageFilter = (COVERAGE_FILTERS as readonly string[]).includes(listParams.coverage)
    ? (listParams.coverage as CoverageFilter)
    : 'all';
  const setTypeFilter = (type: FilterType) => updateListParams({ type });
  const setCoverageFilter = (coverage: CoverageFilter) => updateListParams({ coverage });
  // The box follows typing at once; filtering waits for the URL, which is
  // written after a pause so a keystroke does not re-sort the whole tenant.
  const commitSearch = useCallback((q: string) => updateListParams({ q }), [updateListParams]);
  const [searchTerm, setSearchTerm] = useDebouncedUrlText(listParams.q, commitSearch, 200);
  const debouncedSearch = listParams.q;
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // A changed filter, search term or sort order starts again from the first page.
  useEffect(() => {
    setPage(0);
  }, [typeFilter, coverageFilter, debouncedSearch, sortField, sortDir]);

  const toggleRow = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRunAnalysis = useCallback(() => {
    void startCoverageRun();
  }, []);

  const filteredItems = useMemo(() => {
    if (!result) return [];
    let items = result.items;

    if (typeFilter !== 'all') {
      items = items.filter(i => i.contentType === typeFilter);
    }
    if (coverageFilter === 'covered') {
      items = items.filter(i => i.hasTestScenario);
    } else if (coverageFilter === 'uncovered') {
      items = items.filter(i => !i.hasTestScenario);
    } else if (coverageFilter === 'at-risk') {
      items = items.filter(isAtRisk);
    }
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      items = items.filter(i =>
        i.name.toLowerCase().includes(term) ||
        i.createdBy.toLowerCase().includes(term)
      );
    }
    return items;
  }, [result, typeFilter, coverageFilter, debouncedSearch]);

  // Sorting is keyed separately so toggling a column does not re-filter.
  const sortedItems = useMemo(() => {
    const items = [...filteredItems].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = collator.compare(a.name, b.name);
      else if (sortField === 'contentType') cmp = collator.compare(a.contentType, b.contentType);
      else if (sortField === 'testScenarioCount') cmp = a.testScenarioCount - b.testScenarioCount;
      else if (sortField === 'modifiedTimestamp') cmp = collator.compare(a.modifiedTimestamp ?? '', b.modifiedTimestamp ?? '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [filteredItems, sortField, sortDir]);

  // Clamp rather than only reset so a shrinking list never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => sortedItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [sortedItems, currentPage]
  );

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const handleExportCSV = useCallback(() => {
    if (!result) return;
    const csv = generateCoverageCSV(sortedItems, !testsNotCollected(result), result.health.runScan);
    downloadFile(csv, 'test-coverage.csv', 'text/csv');
  }, [result, sortedItems]);

  const handleExportMarkdown = useCallback(() => {
    if (!result) return;
    const md = generateCoverageMarkdown(result);
    downloadFile(md, 'test-coverage-report.md', 'text/markdown');
  }, [result]);

  const baseUrl = getSasViyaUrl();

  // Collections that were skipped or truncated. When the tests themselves
  // could not be read, no asset's coverage is known, so the figures read
  // "n/a" rather than a 0% that looks like a real finding.
  const gaps = useMemo(() => (result ? collectionGaps(result) : []), [result]);
  const noTests = result ? testsNotCollected(result) : false;
  const skippedTypes = useMemo(
    () => new Set(gaps.filter(g => g.status === 'skipped').map(g => g.key)),
    [gaps],
  );
  // The asset and test walks; the latest-run scan is reported on its own.
  const assetGaps = useMemo(() => gaps.filter(g => g.key !== 'scoreExecution'), [gaps]);
  const runGap = gaps.find(g => g.key === 'scoreExecution');
  const health = result?.health;
  const showHealth = !!result && !noTests && result.stats.overall.itemsWithTests > 0;

  // Score links for decision rows: one modelPublish query for every flow,
  // only once a result lists decisions.
  const mas = useDecisionMasIndex(!!result && result.stats.byType.decision.total > 0);

  return (
    <div className="coverage-analysis">
      <PageHeader
        title="Test Coverage Analysis"
        subtitle="Analyze test coverage across SAS Intelligent Decisioning &amp; Model Manager assets"
        actions={
          <>
            {result && (
              <>
                <Button variant="secondary" size="small" onClick={handleExportMarkdown}>
                  Export Markdown
                </Button>
                <Button variant="secondary" size="small" onClick={handleExportCSV}>
                  Export CSV
                </Button>
              </>
            )}
            {loading && (
              <Button variant="secondary" onClick={cancelCoverageRun}>
                Cancel
              </Button>
            )}
            <Button variant="primary" onClick={handleRunAnalysis} loading={loading}>
              {result ? 'Re-run Analysis' : 'Run Analysis'}
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="error" title="Analysis Failed" dismissible onClose={() => setError(null)}>
          {error}
          {result && ' The results below are from the previous analysis.'}
        </Alert>
      )}

      {cancelled && !loading && (
        <Alert
          variant="info"
          dismissible
          onClose={() => setRunState({ cancelled: false })}
        >
          Analysis cancelled.
          {result && ' The results below are from the previous analysis.'}
        </Alert>
      )}

      {/* Progress indicator — above the previous results during a re-run.
          The run carries on if you leave the page; coming back shows it. */}
      {loading && progress && (
        <Card>
          <CardBody>
            <ProgressBar
              label="Coverage collection progress"
              value={progress.currentStep}
              max={progress.totalSteps}
              phase={progress.phase === 'analyzing' ? 'Analyzing coverage' : 'Collecting data'}
              count={`${progress.itemsCollected} items collected`}
              message={progress.message}
              steps={<span>Step {progress.currentStep} of {progress.totalSteps}</span>}
            />
            <p className="coverage-run-note">
              {result
                ? `The results below are from ${new Date(result.collectionDate).toLocaleString()} and are replaced when this run finishes. `
                : ''}
              You can leave this page; the analysis carries on and is shown here when you come back.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Welcome state */}
      {!result && !loading && (
        <Card>
          <CardBody>
            <div className="coverage-welcome">
              <svg className="coverage-welcome__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <h2 className="coverage-welcome__title">Discover Your Test Coverage</h2>
              <p className="coverage-welcome__text">
                This analysis collects all Decisions, Business Rules, Code Files, Treatment Definitions,
                and Segmentation Trees from your SAS Viya environment, then checks which assets have
                test scenarios defined via Score Definitions.
              </p>
              <p className="coverage-welcome__note">
                The collection process takes a few minutes depending on the number of assets in your environment.
              </p>
              <Button variant="primary" onClick={handleRunAnalysis}>
                Start Analysis
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Results */}
      {result && (
        <>
          {assetGaps.length > 0 && (
            <Alert
              variant="warning"
              title={noTests
                ? 'Test coverage could not be determined'
                : `${assetGaps.length} collection${assetGaps.length === 1 ? ' was' : 's were'} not read completely`}
            >
              <p className="coverage-gaps__intro">
                {noTests
                  ? 'The score definitions (tests) could not be read, so coverage is shown as n/a. Asset counts are still listed.'
                  : 'The figures below cover only what was collected; assets in these collections are missing or incomplete.'}
              </p>
              <ul className="coverage-gaps__list">
                {assetGaps.map(g => (
                  <li key={g.key}>
                    <strong>{g.label}</strong>: {describeCollectionStatus(g)}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {!noTests && runGap && (
            <Alert
              variant="info"
              title={runGap.status === 'skipped' ? 'Last runs could not be read' : 'Last runs are incomplete'}
            >
              <p className="coverage-gaps__intro">
                {runGap.status === 'skipped'
                  ? `The score executions could not be read${runGap.httpStatus ? ` (HTTP ${runGap.httpStatus})` : ''}, so no test shows a last run. Coverage itself is not affected.`
                  : `The newest-first scan of score executions ${describeCollectionStatus(runGap)}. Those tests show "No run in scan": a run may exist further back.`}
              </p>
            </Alert>
          )}

          {/* Summary Dashboard */}
          <div className="coverage-dashboard">
            {/* Overall coverage gauge */}
            <Card className="coverage-gauge-card">
              <CardBody>
                <div className="coverage-gauge">
                  <svg viewBox="0 0 120 120" className="coverage-gauge__ring">
                    <circle cx="60" cy="60" r="52" className="coverage-gauge__track" />
                    <circle
                      cx="60" cy="60" r="52"
                      className="coverage-gauge__fill"
                      style={{
                        strokeDasharray: `${2 * Math.PI * 52}`,
                        strokeDashoffset: `${2 * Math.PI * 52 * (1 - (noTests ? 0 : result.stats.overall.coveragePercentage) / 100)}`,
                      }}
                    />
                  </svg>
                  <div className="coverage-gauge__value">
                    {noTests ? 'n/a' : `${result.stats.overall.coveragePercentage}%`}
                  </div>
                  <div className="coverage-gauge__label">
                    {noTests ? 'Overall Coverage (tests not collected)' : 'Overall Coverage'}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Stats cards — the shared .sas-stat-card tile */}
            <div className="coverage-stats-grid">
              <div className="sas-card sas-stat-card">
                <div className="sas-stat-value">{result.stats.overall.totalItems}</div>
                <div className="sas-stat-label">Total Assets</div>
              </div>
              <div className="sas-card sas-stat-card coverage-stat--success">
                <div className="sas-stat-value">{noTests ? 'n/a' : result.stats.overall.itemsWithTests}</div>
                <div className="sas-stat-label">With Tests</div>
              </div>
              <div className="sas-card sas-stat-card coverage-stat--error">
                <div className="sas-stat-value">{noTests ? 'n/a' : result.stats.overall.itemsWithoutTests}</div>
                <div className="sas-stat-label">Without Tests</div>
              </div>
              <div className="sas-card sas-stat-card coverage-stat--date">
                <div className="sas-stat-value">
                  {new Date(result.collectionDate).toLocaleDateString()}
                </div>
                <div className="sas-stat-label">Collected</div>
              </div>
            </div>
          </div>

          {/* Test health: what the latest runs and the asset changes say */}
          {showHealth && health && (
            <Card className="coverage-health-card">
              <CardHeader
                actions={health.atRisk > 0 ? (
                  // One button that toggles, so keyboard focus stays on it.
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => setCoverageFilter(coverageFilter === 'at-risk' ? 'all' : 'at-risk')}
                  >
                    {coverageFilter === 'at-risk'
                      ? 'Show all assets'
                      : `Show the ${health.atRisk} covered but failing or changed`}
                  </Button>
                ) : undefined}
              >
                <h3>Test Health</h3>
              </CardHeader>
              <CardBody>
                <ul className="coverage-health__counts" aria-label="Covered assets by test health">
                  <HealthCount health="healthy" count={health.healthy} runScan={health.runScan}
                    hint="no latest run failed, at least one completed" />
                  <HealthCount health="failing" count={health.failing} runScan={health.runScan}
                    hint="a test's latest run failed" />
                  <HealthCount health="noRun" count={health.noRun} runScan={health.runScan}
                    hint="no completed or failed run recorded" />
                  {health.unknown > 0 && (
                    <HealthCount health="unknown" count={health.unknown} runScan={health.runScan}
                      hint={health.runScan === 'failed' ? 'the executions could not be read' : 'a run may exist further back'} />
                  )}
                  <li className="coverage-health__count coverage-health__count--changed">
                    {CHANGED_ICON}
                    <span className="coverage-health__value">{health.changedSinceTests}</span>
                    <span className="coverage-health__label">
                      Changed since tests
                      <span className="coverage-health__hint">every test predates the asset's current state</span>
                    </span>
                  </li>
                </ul>
                <p className="coverage-health__note">
                  Last run is the state SAS recorded for the newest score execution of each test; "completed"
                  means the run finished, not that its expected values matched. "Changed since test" means the
                  test targets another revision than the asset's current one, or the asset was modified after the
                  test was created; it does not say the test would now fail.
                  {' '}Latest runs found for {health.testsWithRun} of {health.tests} tests
                  {health.runScan === 'capped'
                    ? `, from the ${health.executionsRead.toLocaleString()} newest score executions (the scan limit).`
                    : health.runScan === 'failed' ? ' (the score executions could not be read).' : '.'}
                </p>
              </CardBody>
            </Card>
          )}

          {/* Coverage by Type Bars */}
          <Card className="coverage-by-type-card">
            <CardHeader>
              <h3>Coverage by Asset Type</h3>
            </CardHeader>
            <CardBody>
              <div className="coverage-type-bars">
                {(Object.entries(result.stats.byType) as [ContentType, typeof result.stats.byType[ContentType]][])
                  // A type that could not be read stays visible as "not collected".
                  .filter(([type, s]) => s.total > 0 || skippedTypes.has(type))
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([type, s]) => skippedTypes.has(type) ? (
                    <div key={type} className="coverage-type-row">
                      <div className="coverage-type-row__label">
                        <span className="coverage-type-row__name">{getContentTypeLabel(type)}</span>
                        <span className="coverage-type-row__count">not collected</span>
                      </div>
                      <div className="coverage-type-row__gap-note">
                        Could not be read{(() => {
                          const status = gaps.find(g => g.key === type)?.httpStatus;
                          return status ? ` (HTTP ${status})` : '';
                        })()}; not included in the totals.
                      </div>
                      <div className="coverage-type-row__pct">n/a</div>
                    </div>
                  ) : (
                    <div key={type} className="coverage-type-row">
                      <div className="coverage-type-row__label">
                        <span className="coverage-type-row__name">{getContentTypeLabel(type)}</span>
                        <span className="coverage-type-row__count">
                          {noTests ? `${s.total} assets` : `${s.withTests} / ${s.total}`}
                        </span>
                      </div>
                      <div className="coverage-type-row__bar-track">
                        {!noTests && (
                          <div
                            className={`coverage-type-row__bar-fill ${getCoverageClass(s.coveragePercentage)}`}
                            style={{ width: `${s.coveragePercentage}%` }}
                          />
                        )}
                      </div>
                      <div className="coverage-type-row__pct">
                        {noTests ? 'n/a' : `${s.coveragePercentage}%`}
                      </div>
                    </div>
                  ))}
              </div>
              <details className="coverage-collections">
                <summary className="coverage-collections__summary">
                  Data collection{gaps.length > 0 ? ` (${gaps.length} incomplete)` : ' (complete)'}
                </summary>
                <table className="sas-table sas-table--compact coverage-collections__table">
                  <thead className="sas-table__head">
                    <tr>
                      <th scope="col" className="sas-table__th">Collection</th>
                      <th scope="col" className="sas-table__th">Status</th>
                      <th scope="col" className="sas-table__th">Items</th>
                    </tr>
                  </thead>
                  <tbody className="sas-table__body">
                    {result.collections.map(c => (
                      <tr key={c.key} className="sas-table__row">
                        <td className="sas-table__td">{c.label}</td>
                        <td className="sas-table__td">
                          <Badge
                            variant={c.status === 'ok' ? 'success' : c.status === 'truncated' ? 'warning' : 'error'}
                            size="small"
                          >
                            {c.status === 'ok' ? 'Complete' : c.status === 'truncated' ? 'Truncated' : 'Not collected'}
                          </Badge>
                        </td>
                        <td className="sas-table__td">{describeCollectionStatus(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!noTests && (
                  <p className="coverage-collections__note">
                    Counted as coverage: {result.scoreDefinitions.tests} test
                    {result.scoreDefinitions.tests === 1 ? '' : 's'} and {result.scoreDefinitions.scenarios} scenario
                    {result.scoreDefinitions.scenarios === 1 ? '' : 's'} of {result.scoreDefinitions.examined} score
                    definitions. Trashed definitions and publishing validations
                    ({result.scoreDefinitions.publishValidations}) are not counted.
                  </p>
                )}
              </details>
            </CardBody>
          </Card>

          {/* Detail Table */}
          <Card className="coverage-detail-card">
            <CardHeader
              actions={
                <div className="coverage-detail__filters">
                  <SearchInput
                    className="coverage-detail__search"
                    aria-label="Search assets by name or author"
                    placeholder="Search by name or author..."
                    value={searchTerm}
                    onChange={setSearchTerm}
                  />
                  <label className="coverage-detail__filter">
                    <span className="coverage-detail__filter-label">Type:</span>
                    <select
                      className="coverage-detail__select"
                      value={typeFilter}
                      onChange={e => setTypeFilter(e.target.value as FilterType)}
                    >
                      <option value="all">All Types</option>
                      <option value="decision">Decisions</option>
                      <option value="businessRule">Business Rules</option>
                      <option value="codeFile">Code Files</option>
                      <option value="model">Models</option>
                      <option value="treatment">Treatments</option>
                      <option value="segmentationTree">Segmentation Trees</option>
                    </select>
                  </label>
                  <label className="coverage-detail__filter">
                    <span className="coverage-detail__filter-label">Coverage:</span>
                    <select
                      className="coverage-detail__select"
                      value={coverageFilter}
                      onChange={e => setCoverageFilter(e.target.value as CoverageFilter)}
                    >
                      <option value="all">All Coverage</option>
                      <option value="covered">Covered</option>
                      <option value="uncovered">Uncovered</option>
                      <option value="at-risk">Covered, but failing or changed since tests</option>
                    </select>
                  </label>
                </div>
              }
            >
              <h3>All Assets ({sortedItems.length})</h3>
            </CardHeader>
            <CardBody>
              <div className="sas-table__wrapper">
                <table className="sas-table sas-table--striped sas-table--hoverable">
                  <thead className="sas-table__head">
                    <tr>
                      <SortHeader field="name" label="Name" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortHeader field="contentType" label="Type" current={sortField} dir={sortDir} onSort={handleSort} width="140px" />
                      <th className="sas-table__th" style={{ width: '90px', textAlign: 'center' }}>Coverage</th>
                      <SortHeader field="testScenarioCount" label="Tests" current={sortField} dir={sortDir} onSort={handleSort} width="80px" align="right" />
                      <th className="sas-table__th" style={{ width: '170px' }}>Test health</th>
                      <th className="sas-table__th" style={{ width: '120px' }}>Created By</th>
                      <SortHeader field="modifiedTimestamp" label="Modified" current={sortField} dir={sortDir} onSort={handleSort} width="110px" />
                      <th className="sas-table__th" style={{ width: '120px', textAlign: 'center' }}>Links</th>
                    </tr>
                  </thead>
                  <tbody className="sas-table__body">
                    {pageItems.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="sas-table__td coverage-detail__empty">
                          No assets match the current filters.
                        </td>
                      </tr>
                    ) : (
                      pageItems.map(item => {
                        const deepLink = getDeepLink(baseUrl, item);
                        const isExpanded = expandedRows.has(item.id);
                        const hasTests = item.testScenarios.length > 0;
                        return (
                          <React.Fragment key={item.id}>
                            <tr
                              className={`sas-table__row coverage-row ${hasTests ? 'coverage-row--expandable' : ''} ${isExpanded ? 'coverage-row--expanded' : ''}`}
                              onClick={hasTests ? () => toggleRow(item.id) : undefined}
                            >
                              <td className="sas-table__td">
                                {hasTests ? (
                                  // Same shape as DataTable's clickable rows: the row reacts to
                                  // the mouse, and a real button in the first cell carries the
                                  // toggle for the keyboard.
                                  <button
                                    type="button"
                                    className="sas-table__row-button coverage-row__name"
                                    aria-expanded={isExpanded}
                                    onClick={e => {
                                      e.stopPropagation();
                                      toggleRow(item.id);
                                    }}
                                  >
                                    <span className={`coverage-row__chevron ${isExpanded ? 'coverage-row__chevron--open' : ''}`}>
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                                        <polyline points="9 18 15 12 9 6" />
                                      </svg>
                                    </span>
                                    <strong>{item.name}</strong>
                                  </button>
                                ) : (
                                  <span className="coverage-row__name">
                                    <strong>{item.name}</strong>
                                  </span>
                                )}
                              </td>
                              <td className="sas-table__td">
                                <Badge variant={getTypeBadgeVariant(item.contentType)} size="small">
                                  {getContentTypeLabel(item.contentType)}
                                </Badge>
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'center' }}>
                                {noTests ? (
                                  <Badge variant="default" size="small">Unknown</Badge>
                                ) : item.hasTestScenario ? (
                                  <Badge variant="success" size="small">Covered</Badge>
                                ) : (
                                  <Badge variant="error" size="small">No tests</Badge>
                                )}
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'right' }}>
                                {item.testScenarioCount > 0 && (
                                  <Badge variant="info" size="small">{item.testScenarioCount}</Badge>
                                )}
                              </td>
                              <td className="sas-table__td">
                                {!noTests && item.testHealth && (
                                  <span className="coverage-health__cell">
                                    <HealthBadge health={item.testHealth} runScan={health?.runScan} />
                                    {item.changedSinceTests && (
                                      <Badge variant="warning" size="small">
                                        <span className="coverage-health__badge">
                                          {CHANGED_ICON}
                                          Changed since tests
                                        </span>
                                      </Badge>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="sas-table__td">{item.createdBy}</td>
                              <td className="sas-table__td">
                                {item.modifiedTimestamp ? new Date(item.modifiedTimestamp).toLocaleDateString() : ''}
                              </td>
                              <td className="sas-table__td" style={{ textAlign: 'center' }}>
                                <span className="coverage-detail__links">
                                  {item.contentType === 'decision' && (() => {
                                    // Only a module MAS was found to have (see findMasModulesForDecisions).
                                    const module = mas.index?.[item.id]?.latest;
                                    if (!module) return null;
                                    const checked = mas.index?.[item.id]?.verified !== false;
                                    return (
                                      <a
                                        href={`#${masModuleRoute(module.publishName)}`}
                                        className="sas-deep-link"
                                        title={`Score in MAS module ${module.publishName}${checked ? '' : ' (from the publish history; MAS could not be checked)'}`}
                                        aria-label={`Score ${item.name} in MAS module ${module.publishName}`}
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <ScoreIcon className="sas-deep-link__icon" />
                                      </a>
                                    );
                                  })()}
                                  {item.contentType === 'segmentationTree' && (
                                    <a
                                      href={`#/segmentation-trees/${encodeURIComponent(item.id)}`}
                                      className="sas-deep-link"
                                      title="Open in Segmentation Tree Explorer"
                                      aria-label={`Open ${item.name} in the Segmentation Tree Explorer`}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <rect x="9" y="2" width="6" height="5" rx="1" />
                                        <rect x="2" y="17" width="6" height="5" rx="1" />
                                        <rect x="16" y="17" width="6" height="5" rx="1" />
                                        <path d="M12 7v5M5 17v-5h14v5" />
                                      </svg>
                                    </a>
                                  )}
                                  {item.contentType === 'decision' && (
                                    <a
                                      href={`#/flows/${item.id}`}
                                      className="sas-deep-link"
                                      title="View Flow Diagram"
                                      aria-label={`View flow diagram for ${item.name}`}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="5" r="2" />
                                        <circle cx="6" cy="19" r="2" />
                                        <circle cx="18" cy="19" r="2" />
                                        <path d="M12 7v4M12 11l-6 6M12 11l6 6" />
                                      </svg>
                                    </a>
                                  )}
                                  {deepLink && (
                                    <a
                                      href={deepLink.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="sas-deep-link"
                                      title={deepLink.label}
                                      aria-label={`${deepLink.label}: ${item.name}`}
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <svg className="sas-deep-link__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                    </a>
                                  )}
                                </span>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="coverage-expand-row">
                                <td colSpan={8} className="coverage-expand-cell">
                                  <div className="coverage-scenarios">
                                    <div className="coverage-scenarios__header">Test Scenarios</div>
                                    <table className="coverage-scenarios__table sas-table sas-table--compact">
                                      <thead className="sas-table__head">
                                        <tr>
                                          <th className="sas-table__th">Name</th>
                                          <th className="sas-table__th" style={{ width: '120px' }}>Type</th>
                                          <th className="sas-table__th" style={{ width: '190px' }}>Last run</th>
                                          <th className="sas-table__th">Changed since test</th>
                                          <th className="sas-table__th">Description</th>
                                        </tr>
                                      </thead>
                                      <tbody className="sas-table__body">
                                        {item.testScenarios.map(ts => (
                                          <tr key={ts.scoreDefinitionId} className="sas-table__row">
                                            <td className="sas-table__td">{ts.name}</td>
                                            <td className="sas-table__td">
                                              <Badge variant={getScenarioTypeBadgeVariant(ts.scenarioType)} size="small">
                                                {ts.scenarioType}
                                              </Badge>
                                            </td>
                                            <td className="sas-table__td">
                                              <LastRunCell test={ts} cap={health?.executionCap} />
                                            </td>
                                            <td className="sas-table__td coverage-scenarios__changes">
                                              <ChangesCell test={ts} />
                                            </td>
                                            <td className="sas-table__td coverage-scenarios__desc">
                                              {ts.description || <span className="coverage-scenarios__none">No description</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <Pagination
                  label="Asset pages"
                  page={currentPage + 1}
                  totalPages={pageCount}
                  pageSize={PAGE_SIZE}
                  totalItems={sortedItems.length}
                  onPageChange={(p) => setPage(p - 1)}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
};

// Helper components

interface SortHeaderProps {
  field: SortField;
  label: string;
  current: SortField;
  dir: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

// The shared .sas-table__sort-header: a real <button> filling the whole
// header cell, with aria-sort on the cell. The button must stay a DIRECT
// child of the <th>, and the <th> must not add padding of its own.
const SortHeader: React.FC<SortHeaderProps> = ({ field, label, current, dir, onSort, width, align = 'left' }) => {
  const isActive = current === field;
  const ariaSort = isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const classes = [
    'sas-table__sort-header',
    isActive ? 'sas-table__sort-header--active' : '',
    // An inline text-align on the <th> no longer positions the button's flex
    // content, so a trailing column asks for the modifier.
    align === 'right' ? 'sas-table__sort-header--end' : '',
  ].filter(Boolean).join(' ');
  return (
    <th className="sas-table__th" style={{ width, textAlign: align }} aria-sort={ariaSort}>
      <button
        type="button"
        className={classes}
        onClick={() => onSort(field)}
      >
        {label}
        <span className="sas-table__sort-icon">
          <svg
            viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2}
            opacity={isActive ? 1 : 0.3}
            aria-hidden="true"
          >
            <path d={isActive && dir === 'asc' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
          </svg>
        </span>
      </button>
    </th>
  );
};

// Test health: state as text and icon, never the colour alone.

const svgProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'coverage-health__icon',
};

const HEALTH_ICON: Record<AssetTestHealth, React.ReactNode> = {
  healthy: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>,
  failing: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>,
  noRun: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>,
  unknown: <svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" /></svg>,
};

const CHANGED_ICON = (
  <svg {...svgProps}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </svg>
);

const HEALTH_VARIANT = {
  healthy: 'success',
  failing: 'error',
  noRun: 'default',
  unknown: 'default',
} as const satisfies Record<AssetTestHealth, string>;

const HealthBadge: React.FC<{ health: AssetTestHealth; runScan?: RunScanStatus }> = ({ health, runScan }) => (
  <Badge variant={HEALTH_VARIANT[health]} size="small">
    <span className="coverage-health__badge">
      {HEALTH_ICON[health]}
      {testHealthLabel(health, runScan)}
    </span>
  </Badge>
);

const HealthCount: React.FC<{ health: AssetTestHealth; count: number; runScan: RunScanStatus; hint: string }> = ({
  health, count, runScan, hint,
}) => (
  <li className={`coverage-health__count coverage-health__count--${health}`}>
    {HEALTH_ICON[health]}
    <span className="coverage-health__value">{count}</span>
    <span className="coverage-health__label">
      {testHealthLabel(health, runScan)}
      <span className="coverage-health__hint">{hint}</span>
    </span>
  </li>
);

/** Execution states mapped to a badge; the state's own word is always shown. */
function runVariant(state: string) {
  switch (state) {
    case 'completed': return 'success' as const;
    case 'failed': return 'error' as const;
    case 'canceled': return 'warning' as const;
    default: return 'info' as const;
  }
}

function runIcon(state: string): React.ReactNode {
  if (state === 'completed') return HEALTH_ICON.healthy;
  if (state === 'failed') return HEALTH_ICON.failing;
  return HEALTH_ICON.noRun;
}

const LastRunCell: React.FC<{ test: TestScenarioInfo; cap?: number }> = ({ test, cap }) => {
  const run = test.lastRun;
  if (!run) {
    return <span className="coverage-scenarios__none">{capitalize(describeLastRun(test, cap))}</span>;
  }
  return (
    <span className="coverage-run">
      <Badge variant={runVariant(run.state)} size="small">
        <span className="coverage-health__badge">
          {runIcon(run.state)}
          {capitalize(run.state)}
        </span>
      </Badge>
      {run.timestamp && (
        <time className="coverage-run__date" dateTime={run.timestamp} title={new Date(run.timestamp).toLocaleString()}>
          {new Date(run.timestamp).toLocaleDateString()}
        </time>
      )}
    </span>
  );
};

const ChangesCell: React.FC<{ test: TestScenarioInfo }> = ({ test }) => {
  if (test.changes.length === 0) {
    return <span className="coverage-scenarios__none">None shown in the metadata</span>;
  }
  return (
    <ul className="coverage-changes" title={describeTestChanges(test)}>
      {test.changes.map(change => (
        <li key={change.kind} className="coverage-changes__item">
          {CHANGED_ICON}
          <span>
            {change.kind === 'revision'
              ? `Targets revision ${shortId(change.testedRevisionId)}; the asset is now at ${shortId(change.currentRevisionId)}`
              : `Asset modified ${new Date(change.assetModified).toLocaleDateString()}, after this test was created (${new Date(change.testCreated).toLocaleDateString()})`}
          </span>
        </li>
      ))}
    </ul>
  );
};

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Helpers

function getCoverageClass(pct: number): string {
  if (pct >= 60) return 'coverage-type-row__bar-fill--good';
  if (pct >= 30) return 'coverage-type-row__bar-fill--moderate';
  return 'coverage-type-row__bar-fill--low';
}

function getTypeBadgeVariant(type: ContentType) {
  switch (type) {
    case 'decision': return 'success' as const;
    case 'businessRule': return 'info' as const;
    case 'codeFile': return 'warning' as const;
    case 'model': return 'info' as const;
    case 'treatment': return 'default' as const;
    case 'segmentationTree': return 'default' as const;
  }
}

function getScenarioTypeBadgeVariant(type: string) {
  switch (type) {
    case 'Test': return 'success' as const;
    case 'Scenario': return 'info' as const;
    case 'Publishing/Validation': return 'warning' as const;
    default: return 'default' as const;
  }
}

function downloadFile(content: string, filename: string, mimeType: string) {
  saveTextFile(content, filename, mimeType);
}

export default CoverageAnalysis;
