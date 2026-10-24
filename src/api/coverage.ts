// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { paginateCollection } from './paginate';
import { ContentItem, ContentType, CoverageByType, CoverageResult, CoverageStats, CollectionProgress, TestScenarioInfo } from '../types/coverage';

/** One walked collection: the content types plus the score definitions. */
export type CoverageCollectionKey = ContentType | 'scoreDefinition';

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

export interface CoverageRunResult extends CoverageResult {
  collections: CoverageCollectionStatus[];
  scoreDefinitions: ScoreDefinitionBreakdown;
}

/** True when the tests themselves could not be read, so no asset's coverage is known. */
export function testsNotCollected(result: CoverageRunResult): boolean {
  return result.collections.some(c => c.key === 'scoreDefinition' && c.status === 'skipped');
}

/** Collections that did not load completely. */
export function collectionGaps(result: CoverageRunResult): CoverageCollectionStatus[] {
  return result.collections.filter(c => c.status !== 'ok');
}

/** "330 of 330", "loaded 100 (no total reported)", "not collected (…)". */
export function describeCollectionStatus(c: CoverageCollectionStatus): string {
  if (c.status === 'skipped') {
    return `not collected${c.error ? ` (${c.error})` : ''}`;
  }
  const counted = c.total !== null ? `${c.loaded} of ${c.total}` : `loaded ${c.loaded} (no total reported)`;
  return c.status === 'truncated' ? `${counted}, stopped at the page limit` : counted;
}

/** The score-definition fields coverage reads. */
export interface ScoreDefinition {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
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
) {
  const headers: Record<string, string> = { Accept: accept };
  if (acceptItem) {
    headers['Accept-Item'] = acceptItem;
  }
  return paginateCollection<Record<string, unknown>>(path, {
    headers,
    params,
    pageSize: COVERAGE_PAGE_SIZE,
  });
}

/** The HTTP status behind a failed walk, read from the error or its message. */
function httpStatusOf(err: unknown): number | undefined {
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
  };
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
      } satisfies TestScenarioInfo);
    }
  }

  return breakdown;
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
): Promise<CoverageRunResult> {
  const contentTypes = Object.keys(CONTENT_ENDPOINTS) as ContentType[];
  const collectionSteps = contentTypes.length + 1; // +1 for score definitions
  const totalSteps = collectionSteps + 1; // +1 for analysis
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
      const walk = await fetchCollection(endpoint.path, endpoint.accept);
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
  const allItems: ContentItem[] = contentResults.flatMap(r => r.items);
  const collections = [...contentResults.map(r => r.status), scoreDefResult.status];

  // Analyze: link test scenarios to content items
  onProgress({
    phase: 'analyzing',
    currentStep: totalSteps,
    totalSteps,
    message: `Analyzing test coverage for ${allItems.length} items...`,
    itemsCollected,
  });

  const breakdown = linkTestScenarios(allItems, scoreDefResult.definitions);

  const stats = calculateStats(allItems);

  return {
    stats,
    items: allItems,
    collectionDate: new Date().toISOString(),
    collections,
    scoreDefinitions: breakdown,
  };
}

// Export helpers for generating downloadable files

/** `testsKnown` false (the tests could not be read) writes "Unknown" instead of "No". */
export function generateCoverageCSV(items: ContentItem[], testsKnown = true): string {
  const headers = ['Name', 'Type', 'Has Test', 'Test Count', 'Created By', 'Created', 'Modified By', 'Modified', 'ID', 'URI'];
  const rows = items.map(item => [
    `"${(item.name ?? '').replace(/"/g, '""')}"`,
    item.contentType,
    !testsKnown ? 'Unknown' : item.hasTestScenario ? 'Yes' : 'No',
    String(item.testScenarioCount),
    item.createdBy,
    item.creationTimestamp,
    item.modifiedBy,
    item.modifiedTimestamp,
    item.id,
    item.uri,
  ].join(','));

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

  if (gaps.length > 0) {
    lines.push(noTests
      ? '> **Warning:** the score definitions (tests) could not be read, so no coverage figure is reported. See Data Collection.'
      : '> **Warning:** some collections were not read completely; the figures below cover only what was collected. See Data Collection.');
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

  // Assets with tests — show linked test details
  const tested = items.filter(i => i.hasTestScenario);
  if (tested.length > 0) {
    lines.push('## Assets With Test Coverage');
    lines.push('');
    for (const item of tested) {
      lines.push(`### ${item.name}`);
      lines.push('');
      lines.push(`**Type:** ${typeLabels[item.contentType] ?? item.contentType} | **Tests:** ${item.testScenarioCount} | **Created By:** ${item.createdBy}`);
      lines.push('');
      lines.push('| Test Name | Scenario Type | Description |');
      lines.push('| --- | --- | --- |');
      for (const ts of item.testScenarios) {
        const desc = ts.description ? ts.description.replace(/\|/g, '\\|') : '-';
        lines.push(`| ${ts.name} | ${ts.scenarioType} | ${desc} |`);
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
