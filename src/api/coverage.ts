// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { paginateCollection } from './paginate';
import {
  AssetTestHealth,
  ContentItem,
  ContentType,
  CoverageByType,
  CoverageResult,
  CoverageStats,
  CollectionProgress,
  LastRunLookup,
  TestChangeReason,
  TestLastRun,
  TestScenarioInfo,
} from '../types/coverage';

/** One walked collection: the content types, the score definitions and their executions. */
export type CoverageCollectionKey = ContentType | 'scoreDefinition' | 'scoreExecution';

/**
 * How one collection walk ended, so a gap is reported instead of showing up
 * only as lower coverage:
 * - ok         every page was read
 * - truncated  the walk stopped at the page cap while more pages existed
 * - skipped    the walk failed (403/404/timeout…) and contributed nothing
 */
export interface CoverageCollectionStatus {
  key: CoverageCollectionKey;
  label: string;
  status: 'ok' | 'truncated' | 'skipped';
  /** Items read. */
  loaded: number;
  /** Total the service reported, or null when it sends no count (scoreDefinitions). */
  total: number | null;
  /** HTTP status of a failed walk, when it can be told. */
  httpStatus?: number;
  /** Why a walk failed. */
  error?: string;
  /** What the walk found, in words, when the counts alone do not say it. */
  note?: string;
}

/** How the score definitions were sorted into coverage. */
export interface ScoreDefinitionBreakdown {
  /** Definitions read (trashed ones are already excluded). */
  examined: number;
  /** properties.test = 'true' (or a test-like name with no type information). */
  tests: number;
  /** inputData.type = 'Scenario'. */
  scenarios: number;
  /** Publishing validations: never coverage. */
  publishValidations: number;
  /** Trashed definitions dropped on the client (the server filter normally drops them first). */
  trashed: number;
}

/**
 * How the latest runs of the tests were read:
 * - complete  every test's latest run was found, or the whole history was read
 * - capped    the newest-first scan stopped at its cap with tests still unfound
 * - failed    the execution history could not be read
 * - none      there were no linked tests to look up
 */
export type RunScanStatus = 'complete' | 'capped' | 'failed' | 'none';

/** Test health across the covered assets (counts of assets unless named otherwise). */
export interface TestHealthSummary {
  healthy: number;
  failing: number;
  noRun: number;
  unknown: number;
  /** Covered assets whose every test shows a change after it. */
  changedSinceTests: number;
  /** Covered assets that are failing or changed since their tests. */
  atRisk: number;
  /** Tests linked to an asset, and how many of them have a run found. */
  tests: number;
  testsWithRun: number;
  /** Tests whose run lookup was cut off by the scan cap. */
  testsNotInScan: number;
  runScan: RunScanStatus;
  /** Executions read during the scan. */
  executionsRead: number;
  /** The scan cap, in executions. */
  executionCap: number;
}

export interface CoverageRunResult extends CoverageResult {
  collections: CoverageCollectionStatus[];
  scoreDefinitions: ScoreDefinitionBreakdown;
  health: TestHealthSummary;
}

/** True when the tests themselves could not be read, so no asset's coverage is known. */
export function testsNotCollected(result: CoverageRunResult): boolean {
  return result.collections.some(c => c.key === 'scoreDefinition' && c.status === 'skipped');
}

/** Collections that did not load completely. */
export function collectionGaps(result: CoverageRunResult): CoverageCollectionStatus[] {
  return result.collections.filter(c => c.status !== 'ok');
}

/** True when an asset counts as "covered, but failing or changed since its tests". */
export function isAtRisk(item: ContentItem): boolean {
  return item.hasTestScenario && (item.testHealth === 'failing' || item.changedSinceTests);
}

/** "330 of 330", "loaded 100 (no total reported)", "not collected (…)". */
export function describeCollectionStatus(c: CoverageCollectionStatus): string {
  if (c.status === 'skipped') {
    return `not collected${c.error ? ` (${c.error})` : ''}`;
  }
  if (c.note) return c.note;
  const counted = c.total !== null ? `${c.loaded} of ${c.total}` : `loaded ${c.loaded} (no total reported)`;
  return c.status === 'truncated' ? `${counted}, stopped at the page limit` : counted;
}

/** The score-definition fields coverage reads. */
export interface ScoreDefinition {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  folderType?: string;
  objectDescriptor?: {
    uri?: string;
    type?: string;
  };
  inputData?: {
    type?: string;
  };
  properties?: Record<string, string>;
  mappings?: Array<{
    mappingType?: string;
  }>;
}

const CONTENT_ENDPOINTS: Record<ContentType, { path: string; accept: string; acceptItem?: string; label: string }> = {
  decision: {
    path: '/decisions/flows',
    accept: 'application/vnd.sas.collection+json, application/json',
    label: 'Decisions',
  },
  businessRule: {
    path: '/businessRules/ruleSets',
    accept: 'application/vnd.sas.collection+json',
    label: 'Business Rules',
  },
  codeFile: {
    path: '/decisions/codeFiles',
    accept: 'application/vnd.sas.collection+json, application/json',
    label: 'Code Files',
  },
  treatment: {
    path: '/treatmentDefinitions/definitions',
    accept: 'application/vnd.sas.collection+json',
    label: 'Treatment Definitions',
  },
  segmentationTree: {
    path: '/decisions/segmentationTrees',
    accept: 'application/vnd.sas.collection+json',
    label: 'Segmentation Trees',
  },
  model: {
    path: '/modelRepository/models',
    accept: 'application/vnd.sas.collection+json, application/json',
    label: 'Models',
  },
};

const COVERAGE_PAGE_SIZE = 100;

/** Progress steps of one run: each content type, the score definitions, their latest runs, then the analysis. */
export const COVERAGE_TOTAL_STEPS = Object.keys(CONTENT_ENDPOINTS).length + 3;

/**
 * The latest-run scan reads /scoreExecution/executions newest first (the
 * service's own order; it sends no count) and stops once every linked test
 * has its latest run, or at this many executions.
 */
const EXECUTION_PAGE_SIZE = 100;
const EXECUTION_MAX_PAGES = 30;
export const EXECUTION_SCAN_CAP = EXECUTION_PAGE_SIZE * EXECUTION_MAX_PAGES;
/** The summary items carry no state or scoreDefinitionId; the full media type does. */
const EXECUTION_ITEM_TYPE = 'application/vnd.sas.score.execution+json';

/** Thrown by collectCoverage when its signal aborts the run. */
export class CoverageRunCancelledError extends Error {
  constructor() {
    super('The coverage analysis was cancelled.');
    this.name = 'CoverageRunCancelledError';
  }
}

export interface CollectCoverageOptions {
  /**
   * Stops the run: each walk ends at its next page boundary (requests
   * already sent still complete) and collectCoverage throws
   * CoverageRunCancelledError instead of returning a partial result.
   */
  signal?: AbortSignal;
}

/**
 * Score definitions in the trash still point at live assets; the same filter
 * listDecisionScenarios uses keeps them out. Live definitions carry no
 * folderType at all, hence the isNull branch.
 */
const NOT_TRASHED_FILTER = "or(isNull(folderType),ne(folderType,'trashFolder'))";

/**
 * Walk one collection completely, with the endpoint's own Accept headers.
 * Returns the walker's result so a truncated walk can be reported.
 */
function fetchCollection(
  path: string,
  accept: string,
  acceptItem?: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = { Accept: accept };
  if (acceptItem) {
    headers['Accept-Item'] = acceptItem;
  }
  return paginateCollection<Record<string, unknown>>(path, {
    headers,
    params,
    pageSize: COVERAGE_PAGE_SIZE,
    // A cancelled run stops asking for further pages.
    onPage: signal ? () => !signal.aborted : undefined,
  });
}

/** The HTTP status behind a failed walk, read from the error or its message. */
function httpStatusOf(err: unknown): number | undefined {
  // ViyaApiError (src/utils/apiErrors.ts) carries the status itself.
  const own = (err as { status?: unknown } | null)?.status;
  if (typeof own === 'number') return own;
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  if (typeof status === 'number') return status;
  const match = err instanceof Error ? err.message.match(/\b([45]\d\d)\b/) : null;
  return match ? Number(match[1]) : undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapToContentItem(raw: Record<string, unknown>, contentType: ContentType): ContentItem {
  return {
    id: String(raw.id ?? ''),
    contentType,
    name: String(raw.name ?? 'Unnamed'),
    description: raw.description ? String(raw.description) : null,
    createdBy: String(raw.createdBy ?? ''),
    creationTimestamp: String(raw.creationTimeStamp ?? raw.creationTimestamp ?? ''),
    modifiedBy: String(raw.modifiedBy ?? ''),
    modifiedTimestamp: String(raw.modifiedTimeStamp ?? raw.modifiedTimestamp ?? ''),
    version: Number(raw.version ?? 0),
    uri: String(
      // Use the canonical self URI when available, falling back to constructed path
      (raw as Record<string, unknown>).uri ??
      `${CONTENT_ENDPOINTS[contentType].path}/${raw.id}`
    ),
    hasTestScenario: false,
    testScenarioCount: 0,
    testScenarios: [],
    currentRevisionId: currentRevisionOf(raw),
    testHealth: null,
    changedSinceTests: false,
  };
}

/**
 * The current revision id an asset's collection item names: a `revisionId`
 * field, or a currentRevision link. Null when it names none (then only the
 * modified-after-test rule applies).
 */
function currentRevisionOf(raw: Record<string, unknown>): string | null {
  if (typeof raw.revisionId === 'string' && raw.revisionId) return raw.revisionId;
  const links = Array.isArray(raw.links) ? (raw.links as Array<{ rel?: string; href?: string; uri?: string }>) : [];
  const link = links.find(l => l?.rel === 'currentRevision');
  return revisionIdOf(link?.uri ?? link?.href ?? '');
}

/** The {revisionId} of a …/revisions/{revisionId} URI; extractIdFromUri drops it. */
export function revisionIdOf(uri: string | null | undefined): string | null {
  const match = uri?.match(/\/revisions\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Extract the resource ID from a URI like /decisions/flows/{id}/revisions/{revisionId}.
 * Mirrors the Python script logic: find UUID segments, prefer the one before "/revisions/",
 * otherwise return the last UUID found.
 */
function extractIdFromUri(uri: string): string | null {
  if (!uri) return null;

  const parts = uri.replace(/^\//, '').split('/');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Walk the path segments looking for UUIDs
  for (let i = 0; i < parts.length; i++) {
    if (uuidPattern.test(parts[i])) {
      // If the next segment is "revisions", this is the resource ID (not the revision)
      if (i + 1 < parts.length && parts[i + 1] === 'revisions') {
        return parts[i];
      }
      // If it's the last segment, it's the ID
      if (i === parts.length - 1) {
        return parts[i];
      }
    }
  }

  return null;
}

/**
 * What a score definition counts as for coverage, or null when it is not a
 * test. Only the properties SAS Intelligent Decisioning writes decide:
 * properties.test = 'true' marks a test (also set by this app's tests),
 * inputData.type = 'Scenario' a scenario; the name never counts. Trashed
 * definitions and publishing validations never count (a validation's
 * objectDescriptor points at a /modelPublish model, so it would not match an
 * asset anyway).
 */
export function classifyScoreDefinition(scoreDef: ScoreDefinition): 'Test' | 'Scenario' | 'Publishing/Validation' | 'Trashed' | null {
  if (scoreDef.folderType === 'trashFolder') return 'Trashed';
  const props = scoreDef.properties ?? {};
  if (scoreDef.objectDescriptor?.type === 'sas.publish.validation' || props.publishDestination) {
    return 'Publishing/Validation';
  }
  if (String(props.test ?? '').toLowerCase() === 'true') return 'Test';
  if (scoreDef.inputData?.type === 'Scenario') return 'Scenario';
  return null;
}

function linkTestScenarios(items: ContentItem[], scoreDefinitions: ScoreDefinition[]): ScoreDefinitionBreakdown {
  // Build a map of content item IDs for quick lookup
  const itemMap = new Map<string, ContentItem>();
  for (const item of items) {
    itemMap.set(item.id, item);
  }

  const breakdown: ScoreDefinitionBreakdown = {
    examined: 0, tests: 0, scenarios: 0, publishValidations: 0, trashed: 0,
  };

  for (const scoreDef of scoreDefinitions) {
    const kind = classifyScoreDefinition(scoreDef);
    if (kind === 'Trashed') {
      breakdown.trashed++;
      continue;
    }
    breakdown.examined++;
    if (kind === 'Publishing/Validation') breakdown.publishValidations++;
    if (kind !== 'Test' && kind !== 'Scenario') continue;
    if (kind === 'Test') breakdown.tests++;
    else breakdown.scenarios++;

    const objectUri = scoreDef.objectDescriptor?.uri;
    if (!objectUri) continue;

    const targetId = extractIdFromUri(objectUri);
    if (!targetId) continue;

    const item = itemMap.get(targetId);
    if (item) {
      item.hasTestScenario = true;
      item.testScenarioCount += 1;
      item.testScenarios.push({
        scoreDefinitionId: scoreDef.id,
        name: scoreDef.name ?? 'Unnamed',
        scenarioType: kind,
        description: scoreDef.description ?? null,
        createdBy: scoreDef.createdBy ?? '',
        inputDataType: scoreDef.inputData?.type ?? null,
        creationTimestamp: scoreDef.creationTimeStamp ?? '',
        targetUri: objectUri,
        testedRevisionId: revisionIdOf(objectUri),
        lastRunLookup: 'unread',
        lastRun: null,
        changes: [],
      } satisfies TestScenarioInfo);
    }
  }

  return breakdown;
}

/** The execution fields the latest-run scan reads (full media type). */
interface ScoreExecutionItem {
  id?: string;
  state?: string;
  creationTimeStamp?: string;
  scoreExecutionRequest?: { scoreDefinitionId?: string };
}

interface LastRunScan {
  runs: Map<string, TestLastRun>;
  status: CoverageCollectionStatus;
  runScan: RunScanStatus;
  executionsRead: number;
}

/**
 * Find the latest execution of each wanted score definition with one
 * newest-first walk of /scoreExecution/executions, keeping the first
 * execution seen per definition. The walk stops once every definition has
 * one, or at EXECUTION_SCAN_CAP executions. (A server filter per definition
 * would be one request per test: eq(scoreExecutionRequest.scoreDefinitionId,…)
 * works, eq(scoreDefinitionId,…) is rejected with 400.)
 */
async function collectLastRuns(wanted: Set<string>, signal?: AbortSignal): Promise<LastRunScan> {
  const label = 'Score Executions (latest test runs)';
  const runs = new Map<string, TestLastRun>();
  if (wanted.size === 0) {
    return {
      runs,
      runScan: 'none',
      executionsRead: 0,
      status: { key: 'scoreExecution', label, status: 'ok', loaded: 0, total: null, note: 'no linked tests to look up' },
    };
  }
  try {
    const walk = await paginateCollection<ScoreExecutionItem>('/scoreExecution/executions', {
      headers: {
        Accept: 'application/vnd.sas.collection+json, application/json',
        'Accept-Item': EXECUTION_ITEM_TYPE,
      },
      pageSize: EXECUTION_PAGE_SIZE,
      maxPages: EXECUTION_MAX_PAGES,
      // Only the executions on the page are needed, never the whole list.
      accumulate: false,
      onPage: (page) => {
        for (const execution of page.items) {
          const definitionId = execution.scoreExecutionRequest?.scoreDefinitionId;
          if (!definitionId || !wanted.has(definitionId) || runs.has(definitionId)) continue;
          runs.set(definitionId, {
            state: String(execution.state ?? 'unknown'),
            executionId: String(execution.id ?? ''),
            timestamp: String(execution.creationTimeStamp ?? ''),
          });
        }
        if (signal?.aborted) return false;
        return runs.size < wanted.size;
      },
    });
    const missing = wanted.size - runs.size;
    const read = walk.loaded;
    const capped = walk.truncated && missing > 0;
    const testsLabel = (n: number) => `${n} test${n === 1 ? '' : 's'}`;
    const note = capped
      ? `read the ${read.toLocaleString()} newest runs (the scan limit); ${testsLabel(missing)} had no run among them`
      : missing === 0
        ? `latest run found for all ${testsLabel(wanted.size)} (read ${read.toLocaleString()} runs)`
        : `read all ${read.toLocaleString()} recorded runs; ${testsLabel(missing)} had none`;
    return {
      runs,
      runScan: capped ? 'capped' : 'complete',
      executionsRead: read,
      status: { key: 'scoreExecution', label, status: capped ? 'truncated' : 'ok', loaded: read, total: null, note },
    };
  } catch (err) {
    console.warn('Failed to read score executions:', err);
    return {
      runs,
      runScan: 'failed',
      executionsRead: 0,
      status: {
        key: 'scoreExecution',
        label,
        status: 'skipped',
        loaded: 0,
        total: null,
        httpStatus: httpStatusOf(err),
        error: errorText(err),
      },
    };
  }
}

/** True when `later` is a timestamp after `earlier` (both must parse). */
function isAfter(later: string, earlier: string): boolean {
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/**
 * Give every linked test its latest run and the asset changes after it, and
 * roll each covered asset up into a test health. Only what the metadata
 * shows: a change after a test does not say the test would now fail.
 */
export function applyTestHealth(
  items: ContentItem[],
  runs: Map<string, TestLastRun>,
  runScan: RunScanStatus,
): Omit<TestHealthSummary, 'runScan' | 'executionsRead' | 'executionCap'> {
  const summary = {
    healthy: 0, failing: 0, noRun: 0, unknown: 0,
    changedSinceTests: 0, atRisk: 0, tests: 0, testsWithRun: 0, testsNotInScan: 0,
  };
  const missingLookup: LastRunLookup =
    runScan === 'capped' ? 'notInScan' : runScan === 'failed' ? 'unread' : 'none';

  for (const item of items) {
    if (item.testScenarios.length === 0) continue;
    let failed = 0;
    let completed = 0;
    let unresolved = 0;
    for (const test of item.testScenarios) {
      summary.tests++;
      const run = runs.get(test.scoreDefinitionId) ?? null;
      test.lastRun = run;
      test.lastRunLookup = run ? 'found' : missingLookup;
      if (run) {
        summary.testsWithRun++;
        if (run.state === 'failed') failed++;
        else if (run.state === 'completed') completed++;
      } else if (missingLookup !== 'none') {
        unresolved++;
        if (missingLookup === 'notInScan') summary.testsNotInScan++;
      }

      const changes: TestChangeReason[] = [];
      if (test.testedRevisionId && item.currentRevisionId && test.testedRevisionId !== item.currentRevisionId) {
        changes.push({
          kind: 'revision',
          testedRevisionId: test.testedRevisionId,
          currentRevisionId: item.currentRevisionId,
        });
      }
      if (test.creationTimestamp && item.modifiedTimestamp && isAfter(item.modifiedTimestamp, test.creationTimestamp)) {
        changes.push({ kind: 'modifiedAfter', assetModified: item.modifiedTimestamp, testCreated: test.creationTimestamp });
      }
      test.changes = changes;
    }

    let health: AssetTestHealth;
    if (failed > 0) health = 'failing';
    else if (completed > 0) health = 'healthy';
    else if (unresolved > 0) health = 'unknown';
    else health = 'noRun';
    item.testHealth = health;
    summary[health]++;

    // Changed since its tests only when no test postdates the asset's state.
    item.changedSinceTests = item.testScenarios.every(t => t.changes.length > 0);
    if (item.changedSinceTests) summary.changedSinceTests++;
    if (isAtRisk(item)) summary.atRisk++;
  }
  return summary;
}

function calculateStats(items: ContentItem[]): CoverageStats {
  const byType: Record<ContentType, CoverageByType> = {
    decision: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
    businessRule: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
    codeFile: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
    treatment: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
    segmentationTree: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
    model: { total: 0, withTests: 0, withoutTests: 0, coveragePercentage: 0 },
  };

  for (const item of items) {
    const bucket = byType[item.contentType];
    bucket.total += 1;
    if (item.hasTestScenario) {
      bucket.withTests += 1;
    } else {
      bucket.withoutTests += 1;
    }
  }

  // Calculate percentages
  for (const key of Object.keys(byType) as ContentType[]) {
    const bucket = byType[key];
    bucket.coveragePercentage = bucket.total > 0
      ? Math.round((bucket.withTests / bucket.total) * 10000) / 100
      : 0;
  }

  const totalItems = items.length;
  const itemsWithTests = items.filter(i => i.hasTestScenario).length;

  return {
    overall: {
      totalItems,
      itemsWithTests,
      itemsWithoutTests: totalItems - itemsWithTests,
      coveragePercentage: totalItems > 0
        ? Math.round((itemsWithTests / totalItems) * 10000) / 100
        : 0,
    },
    byType,
  };
}

export async function collectCoverage(
  onProgress: (progress: CollectionProgress) => void,
  options: CollectCoverageOptions = {},
): Promise<CoverageRunResult> {
  const { signal } = options;
  const contentTypes = Object.keys(CONTENT_ENDPOINTS) as ContentType[];
  // Each content type + score definitions + analysis.
  const totalSteps = COVERAGE_TOTAL_STEPS;
  // The seven walks are independent of each other, so they run concurrently
  // and progress counts completed collections rather than a sequential index.
  let completedSteps = 0;
  let itemsCollected = 0;

  const reportCollecting = (message: string): void => {
    onProgress({
      phase: 'collecting',
      currentStep: completedSteps,
      totalSteps,
      message,
      itemsCollected,
    });
  };

  reportCollecting('Collecting content and score definitions...');

  // A failed or truncated walk is recorded, never just logged: the finished
  // view and the Markdown export both report it (covpub-2).
  const statusOf = (
    key: CoverageCollectionKey,
    label: string,
    walk: { loaded: number; total: number | null; truncated: boolean },
  ): CoverageCollectionStatus => ({
    key,
    label,
    status: walk.truncated ? 'truncated' : 'ok',
    loaded: walk.loaded,
    total: walk.total,
  });
  const skippedStatus = (key: CoverageCollectionKey, label: string, err: unknown): CoverageCollectionStatus => ({
    key,
    label,
    status: 'skipped',
    loaded: 0,
    total: null,
    httpStatus: httpStatusOf(err),
    error: errorText(err),
  });

  const collectContentType = async (
    contentType: ContentType,
  ): Promise<{ items: ContentItem[]; status: CoverageCollectionStatus }> => {
    const endpoint = CONTENT_ENDPOINTS[contentType];
    try {
      const walk = await fetchCollection(endpoint.path, endpoint.accept, undefined, undefined, signal);
      const items = walk.items.map(raw => mapToContentItem(raw, contentType));
      itemsCollected += items.length;
      completedSteps++;
      reportCollecting(`Collected ${endpoint.label} (${items.length})`);
      return { items, status: statusOf(contentType, endpoint.label, walk) };
    } catch (err) {
      // Some endpoints 404 when the service isn't licensed, or 403 for the user.
      console.warn(`Failed to collect ${endpoint.label}:`, err);
      completedSteps++;
      reportCollecting(`Skipped ${endpoint.label}`);
      return { items: [], status: skippedStatus(contentType, endpoint.label, err) };
    }
  };

  const collectScoreDefinitions = async (): Promise<{
    definitions: ScoreDefinition[];
    status: CoverageCollectionStatus;
  }> => {
    const label = 'Score Definitions (tests)';
    const walkDefinitions = (params?: Record<string, string>) => fetchCollection(
      '/scoreDefinitions/definitions',
      'application/vnd.sas.collection+json, application/json',
      'application/vnd.sas.score.definition+json', // Accept-Item: get full details with objectDescriptor
      params,
      signal,
    );
    try {
      let walk;
      try {
        walk = await walkDefinitions({ filter: NOT_TRASHED_FILTER });
      } catch (filterErr) {
        // A service that rejects the filter (the client's error interceptor
        // drops the 400 status, so this can't test for it) is walked
        // unfiltered; trashed definitions are then dropped on the client
        // (classifyScoreDefinition). Access errors would only fail again.
        const status = httpStatusOf(filterErr);
        if (status === 401 || status === 403) throw filterErr;
        walk = await walkDefinitions();
      }
      completedSteps++;
      reportCollecting(`Collected Score Definitions (${walk.items.length})`);
      return {
        definitions: walk.items as unknown as ScoreDefinition[],
        status: statusOf('scoreDefinition', label, walk),
      };
    } catch (err) {
      console.warn('Failed to collect score definitions:', err);
      completedSteps++;
      reportCollecting('Skipped Score Definitions');
      return { definitions: [], status: skippedStatus('scoreDefinition', label, err) };
    }
  };

  // Promise.all keeps the input order, so allItems stays grouped by content
  // type exactly as the sequential walk produced it (exports are unchanged).
  const [contentResults, scoreDefResult] = await Promise.all([
    Promise.all(contentTypes.map(collectContentType)),
    collectScoreDefinitions(),
  ]);
  // A cancelled run's walks ended early and look complete; never report them.
  if (signal?.aborted) throw new CoverageRunCancelledError();
  const allItems: ContentItem[] = contentResults.flatMap(r => r.items);

  // Link test scenarios to content items, then look up the latest run of
  // every linked test (only those: an unlinked one would keep the
  // newest-first scan going to its cap).
  const breakdown = linkTestScenarios(allItems, scoreDefResult.definitions);
  const wanted = new Set(allItems.flatMap(i => i.testScenarios.map(t => t.scoreDefinitionId)));
  reportCollecting(`Reading the latest runs of ${wanted.size} tests...`);
  const lastRuns = await collectLastRuns(wanted, signal);
  if (signal?.aborted) throw new CoverageRunCancelledError();
  completedSteps++;
  const collections = [...contentResults.map(r => r.status), scoreDefResult.status, lastRuns.status];

  onProgress({
    phase: 'analyzing',
    currentStep: totalSteps,
    totalSteps,
    message: `Analyzing test coverage for ${allItems.length} items...`,
    itemsCollected,
  });

  const health: TestHealthSummary = {
    ...applyTestHealth(allItems, lastRuns.runs, lastRuns.runScan),
    runScan: lastRuns.runScan,
    executionsRead: lastRuns.executionsRead,
    executionCap: EXECUTION_SCAN_CAP,
  };

  const stats = calculateStats(allItems);

  return {
    stats,
    items: allItems,
    collectionDate: new Date().toISOString(),
    collections,
    scoreDefinitions: breakdown,
    health,
  };
}

// Export helpers for generating downloadable files

/** The words for an asset's test health; the UI, the CSV and the Markdown all use them. */
export function testHealthLabel(health: AssetTestHealth | null, runScan?: RunScanStatus): string {
  switch (health) {
    case 'healthy': return 'Healthy';
    case 'failing': return 'Failing';
    case 'noRun': return 'No finished run';
    case 'unknown': return runScan === 'failed' ? 'Runs not read' : 'No run in scan';
    default: return '';
  }
}

/** What a test's latest-run lookup found, in words: "completed 2026-10-20 14:03" or why there is none. */
export function describeLastRun(test: TestScenarioInfo, executionCap = EXECUTION_SCAN_CAP): string {
  if (test.lastRun) {
    const when = test.lastRun.timestamp ? new Date(test.lastRun.timestamp).toLocaleString() : 'date not recorded';
    return `${test.lastRun.state} (${when})`;
  }
  switch (test.lastRunLookup) {
    case 'none': return 'no run recorded';
    case 'notInScan': return `no run in the ${executionCap.toLocaleString()} newest runs`;
    default: return 'runs not read';
  }
}

/** A test's changes after it, in words, or '' when the metadata shows none. */
export function describeTestChanges(test: TestScenarioInfo): string {
  return test.changes.map(change => change.kind === 'revision'
    ? `targets revision ${shortId(change.testedRevisionId)}; the asset is now at revision ${shortId(change.currentRevisionId)}`
    : `asset modified ${new Date(change.assetModified).toLocaleString()}, after the test was created ${new Date(change.testCreated).toLocaleString()}`,
  ).join('; ');
}

/** The first block of a revision UUID, enough to tell two apart. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** The newest latest-run of an asset's tests, or null. */
export function newestRun(item: ContentItem): TestLastRun | null {
  let newest: TestLastRun | null = null;
  for (const test of item.testScenarios) {
    if (test.lastRun && (!newest || (Date.parse(test.lastRun.timestamp) || 0) > (Date.parse(newest.timestamp) || 0))) {
      newest = test.lastRun;
    }
  }
  return newest;
}

/**
 * `testsKnown` false (the tests could not be read) writes "Unknown" instead of "No".
 * `runScan` names how the latest runs were read, for the health column's words.
 */
export function generateCoverageCSV(items: ContentItem[], testsKnown = true, runScan?: RunScanStatus): string {
  const headers = [
    'Name', 'Type', 'Has Test', 'Test Count', 'Test Health', 'Changed Since Tests', 'Latest Run State', 'Latest Run',
    'Created By', 'Created', 'Modified By', 'Modified', 'ID', 'URI',
  ];
  const rows = items.map(item => {
    const run = newestRun(item);
    return [
      `"${(item.name ?? '').replace(/"/g, '""')}"`,
      item.contentType,
      !testsKnown ? 'Unknown' : item.hasTestScenario ? 'Yes' : 'No',
      String(item.testScenarioCount),
      testHealthLabel(item.testHealth, runScan),
      item.hasTestScenario ? (item.changedSinceTests ? 'Yes' : 'No') : '',
      run?.state ?? '',
      run?.timestamp ?? '',
      item.createdBy,
      item.creationTimestamp,
      item.modifiedBy,
      item.modifiedTimestamp,
      item.id,
      item.uri,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function generateCoverageMarkdown(result: CoverageRunResult): string {
  const { stats, items } = result;
  const lines: string[] = [];
  const noTests = testsNotCollected(result);
  const gaps = collectionGaps(result);
  const statusByKey = new Map(result.collections.map(c => [c.key, c]));
  const cell = (s: string) => s.replace(/\|/g, '\\|');

  lines.push(`# Test Coverage Report`);
  lines.push('');
  lines.push(`**Generated:** ${new Date(result.collectionDate).toLocaleString()}`);
  lines.push('');

  const assetGaps = gaps.filter(g => g.key !== 'scoreExecution');
  if (assetGaps.length > 0) {
    lines.push(noTests
      ? '> **Warning:** the score definitions (tests) could not be read, so no coverage figure is reported. See Data Collection.'
      : '> **Warning:** some collections were not read completely; the figures below cover only what was collected. See Data Collection.');
    lines.push('');
  }
  const health = result.health;
  if (!noTests && (health.runScan === 'capped' || health.runScan === 'failed')) {
    lines.push(health.runScan === 'capped'
      ? `> **Note:** the latest-run scan read the ${health.executionsRead.toLocaleString()} newest score executions (its limit); ` +
        `${health.testsNotInScan} test${health.testsNotInScan === 1 ? ' has' : 's have'} no run among them, so their last run is not known.`
      : '> **Note:** the score executions could not be read, so no test has a known last run. See Data Collection.');
    lines.push('');
  }

  // Overall summary
  lines.push('## Overall Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Assets | ${stats.overall.totalItems} |`);
  lines.push(`| With Tests | ${noTests ? 'n/a' : stats.overall.itemsWithTests} |`);
  lines.push(`| Without Tests | ${noTests ? 'n/a' : stats.overall.itemsWithoutTests} |`);
  lines.push(`| **Coverage** | **${noTests ? 'n/a' : `${stats.overall.coveragePercentage}%`}** |`);
  lines.push('');

  // Test health of the covered assets
  if (!noTests && stats.overall.itemsWithTests > 0) {
    lines.push('## Test Health');
    lines.push('');
    lines.push('Last run = the state SAS recorded for the newest score execution of each test ("completed" means the run finished, not that expected values matched). ' +
      '"Changed since tests" = for every test of the asset, the test targets another revision than the current one, or the asset was modified after the test was created.');
    lines.push('');
    lines.push('| Covered assets | Count |');
    lines.push('| --- | ---: |');
    lines.push(`| Healthy (no latest run failed, at least one completed) | ${health.healthy} |`);
    lines.push(`| Failing (a test's latest run failed) | ${health.failing} |`);
    lines.push(`| No finished run | ${health.noRun} |`);
    if (health.unknown > 0) lines.push(`| ${testHealthLabel('unknown', health.runScan)} | ${health.unknown} |`);
    lines.push(`| Changed since tests | ${health.changedSinceTests} |`);
    lines.push(`| **Covered, but failing or changed since tests** | **${health.atRisk}** |`);
    lines.push('');
  }

  // What was read, and what counted as a test
  lines.push('## Data Collection');
  lines.push('');
  lines.push('| Collection | Status | Items |');
  lines.push('| --- | --- | --- |');
  for (const c of result.collections) {
    const status = c.status === 'ok' ? 'Complete' : c.status === 'truncated' ? 'Truncated' : 'Not collected';
    lines.push(`| ${c.label} | ${status} | ${cell(describeCollectionStatus(c))} |`);
  }
  lines.push('');
  if (!noTests) {
    const sd = result.scoreDefinitions;
    lines.push(
      `Counted as coverage: ${sd.tests} test${sd.tests === 1 ? '' : 's'} and ${sd.scenarios} scenario${sd.scenarios === 1 ? '' : 's'} ` +
      `of ${sd.examined} score definitions. Trashed definitions` +
      `${sd.trashed > 0 ? ` (${sd.trashed})` : ''} and publishing validations (${sd.publishValidations}) are not counted.`,
    );
    lines.push('');
  }

  // Coverage by type
  lines.push('## Coverage by Type');
  lines.push('');
  lines.push('| Type | Total | With Tests | Without Tests | Coverage |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');

  const typeLabels: Record<ContentType, string> = {
    decision: 'Decisions',
    businessRule: 'Business Rules',
    codeFile: 'Code Files',
    treatment: 'Treatment Definitions',
    segmentationTree: 'Segmentation Trees',
    model: 'Models',
  };

  for (const [type, label] of Object.entries(typeLabels)) {
    const s = stats.byType[type as ContentType];
    if (statusByKey.get(type as ContentType)?.status === 'skipped') {
      // A type that could not be read is listed, not silently dropped.
      lines.push(`| ${label} | not collected | – | – | n/a |`);
    } else if (s.total > 0) {
      lines.push(noTests
        ? `| ${label} | ${s.total} | n/a | n/a | n/a |`
        : `| ${label} | ${s.total} | ${s.withTests} | ${s.withoutTests} | ${s.coveragePercentage}% |`);
    }
  }
  lines.push('');

  // The release risk: covered, but failing or changed since the tests
  const atRisk = items.filter(isAtRisk);
  if (atRisk.length > 0) {
    lines.push('## Covered, But Failing or Changed Since Tests');
    lines.push('');
    lines.push('| Name | Type | Test Health | Changed Since Tests |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of atRisk) {
      lines.push(`| ${cell(item.name)} | ${typeLabels[item.contentType] ?? item.contentType} | ` +
        `${testHealthLabel(item.testHealth, health.runScan)} | ${item.changedSinceTests ? 'Yes' : 'No'} |`);
    }
    lines.push('');
  }

  // Assets with tests — show linked test details
  const tested = items.filter(i => i.hasTestScenario);
  if (tested.length > 0) {
    lines.push('## Assets With Test Coverage');
    lines.push('');
    for (const item of tested) {
      lines.push(`### ${item.name}`);
      lines.push('');
      lines.push(`**Type:** ${typeLabels[item.contentType] ?? item.contentType} | **Tests:** ${item.testScenarioCount} | ` +
        `**Test Health:** ${testHealthLabel(item.testHealth, health.runScan) || 'n/a'} | **Created By:** ${item.createdBy}`);
      lines.push('');
      lines.push('| Test Name | Scenario Type | Last Run | Changed Since Test | Description |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const ts of item.testScenarios) {
        const desc = ts.description ? ts.description.replace(/\|/g, '\\|') : '-';
        const changes = describeTestChanges(ts) || 'no change shown';
        lines.push(`| ${ts.name} | ${ts.scenarioType} | ${cell(describeLastRun(ts, health.executionCap))} | ${cell(changes)} | ${desc} |`);
      }
      lines.push('');
    }
  }

  // Items without tests
  const untested = items.filter(i => !i.hasTestScenario);
  if (untested.length > 0) {
    // Without the tests nothing is known to be untested; list the assets only.
    lines.push(noTests ? '## Assets (test coverage unknown)' : '## Assets Without Test Coverage');
    lines.push('');
    lines.push('| Name | Type | Created By | Modified |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of untested) {
      const modified = item.modifiedTimestamp ? new Date(item.modifiedTimestamp).toLocaleDateString() : '';
      lines.push(`| ${item.name} | ${typeLabels[item.contentType] ?? item.contentType} | ${item.createdBy} | ${modified} |`);
    }
  }

  return lines.join('\n');
}

export function getContentTypeLabel(type: ContentType): string {
  const labels: Record<ContentType, string> = {
    decision: 'Decision',
    businessRule: 'Business Rule',
    codeFile: 'Code File',
    treatment: 'Treatment',
    segmentationTree: 'Segmentation Tree',
    model: 'Model',
  };
  return labels[type] ?? type;
}

export function getDeepLink(baseUrl: string, item: ContentItem): { url: string; label: string } | null {
  const id = item.id;
  switch (item.contentType) {
    case 'decision':
      return { url: `${baseUrl}/SASDecisionManager/decisions/${id}`, label: 'Open in Intelligent Decisioning' };
    case 'businessRule':
      return { url: `${baseUrl}/SASDecisionManager/ruleSets/${id}`, label: 'Open in Intelligent Decisioning' };
    case 'codeFile':
      return { url: `${baseUrl}/SASDecisionManager/codeFiles/${id}`, label: 'Open in Intelligent Decisioning' };
    case 'treatment':
      return { url: `${baseUrl}/SASDecisionManager/treatmentDefinitions/${id}`, label: 'Open in Intelligent Decisioning' };
    case 'segmentationTree':
      return { url: `${baseUrl}/SASDecisionManager/segmentationTrees/${id}`, label: 'Open in Intelligent Decisioning' };
    case 'model':
      return { url: `${baseUrl}/SASModelManager/models/${id}`, label: 'Open in Model Manager' };
    default:
      return null;
  }
}
