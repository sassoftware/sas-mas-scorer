// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { ContentItem, ContentType, CoverageByType, CoverageResult, CoverageStats, CollectionProgress, TestScenarioInfo } from '../types/coverage';

interface ApiCollectionResponse {
  items?: Array<Record<string, unknown>>;
  count?: number;
  start?: number;
  limit?: number;
}

interface ScoreDefinition {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
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

async function fetchAllPaginated(
  path: string,
  accept: string,
  acceptItem?: string,
  pageSize = 100,
): Promise<Array<Record<string, unknown>>> {
  const allItems: Array<Record<string, unknown>>[] = [];
  let start = 0;
  let hasMore = true;

  const headers: Record<string, string> = { Accept: accept };
  if (acceptItem) {
    headers['Accept-Item'] = acceptItem;
  }

  while (hasMore) {
    const response = await sasViyaClient.get<ApiCollectionResponse>(path, {
      params: { start, limit: pageSize },
      headers,
    });

    const items = response.data.items ?? [];
    allItems.push(items);

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      start += pageSize;
    }
  }

  return allItems.flat();
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
 * Identify which score definitions represent test scenarios.
 * Mirrors the Python script: properties.test == "true" OR name contains "test"/"scenario".
 */
function isTestScoreDefinition(scoreDef: ScoreDefinition): boolean {
  const props = scoreDef.properties ?? {};
  if (String(props.test ?? '').toLowerCase() === 'true') return true;

  const name = (scoreDef.name ?? '').toLowerCase();
  if (/test|scenario/.test(name)) return true;

  return false;
}

/**
 * Determine the scenario type following the Python script's priority logic.
 */
function determineScenarioType(scoreDef: ScoreDefinition): string {
  const name = (scoreDef.name ?? '').toLowerCase();
  const objType = scoreDef.objectDescriptor?.type ?? '';
  const inputType = scoreDef.inputData?.type ?? '';
  const props = scoreDef.properties ?? {};

  // Publishing/Validation (highest priority)
  if (objType === 'sas.publish.validation' || props.publishDestination ||
      name.includes('publishing') || (name.includes('publish') && !name.includes('validation'))) {
    return 'Publishing/Validation';
  }
  // Explicit Scenario input type
  if (inputType === 'Scenario') return 'Scenario';
  // Test property or name
  if (String(props.test ?? '').toLowerCase() === 'true' || name.includes('test')) return 'Test';
  // Scenario in name
  if (name.includes('scenario')) return 'Scenario';

  return 'Other';
}

function linkTestScenarios(items: ContentItem[], scoreDefinitions: ScoreDefinition[]): void {
  // Build a map of content item IDs for quick lookup
  const itemMap = new Map<string, ContentItem>();
  for (const item of items) {
    itemMap.set(item.id, item);
  }

  // Filter to test score definitions, then link to content items
  const testScoreDefs = scoreDefinitions.filter(isTestScoreDefinition);
  console.log(`[Coverage] Found ${scoreDefinitions.length} score definitions, ${testScoreDefs.length} are test scenarios`);

  let linked = 0;
  for (const scoreDef of testScoreDefs) {
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
        scenarioType: determineScenarioType(scoreDef),
        description: scoreDef.description ?? null,
        createdBy: scoreDef.createdBy ?? '',
        inputDataType: scoreDef.inputData?.type ?? null,
      } satisfies TestScenarioInfo);
      linked++;
    }
  }

  console.log(`[Coverage] Linked ${linked} test scenarios to content items`);
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
): Promise<CoverageResult> {
  const contentTypes = Object.keys(CONTENT_ENDPOINTS) as ContentType[];
  const totalSteps = contentTypes.length + 2; // +1 for score definitions, +1 for analysis
  let currentStep = 0;
  let itemsCollected = 0;

  const allItems: ContentItem[] = [];

  // Collect each content type
  for (const contentType of contentTypes) {
    const endpoint = CONTENT_ENDPOINTS[contentType];
    currentStep++;
    onProgress({
      phase: 'collecting',
      currentStep,
      totalSteps,
      message: `Collecting ${endpoint.label}...`,
      itemsCollected,
    });

    try {
      const rawItems = await fetchAllPaginated(endpoint.path, endpoint.accept);
      const items = rawItems.map(raw => mapToContentItem(raw, contentType));
      allItems.push(...items);
      itemsCollected += items.length;
    } catch (err) {
      // Some endpoints may 404 if the service isn't licensed — skip gracefully
      console.warn(`Failed to collect ${endpoint.label}:`, err);
    }
  }

  // Collect score definitions for test scenario linking
  currentStep++;
  onProgress({
    phase: 'collecting',
    currentStep,
    totalSteps,
    message: 'Collecting Score Definitions (test scenarios)...',
    itemsCollected,
  });

  let scoreDefinitions: ScoreDefinition[] = [];
  try {
    const rawScoreDefs = await fetchAllPaginated(
      '/scoreDefinitions/definitions',
      'application/vnd.sas.collection+json, application/json',
      'application/vnd.sas.score.definition+json', // Accept-Item: get full details with objectDescriptor
    );
    scoreDefinitions = rawScoreDefs as unknown as ScoreDefinition[];
  } catch (err) {
    console.warn('Failed to collect score definitions:', err);
  }

  // Analyze: link test scenarios to content items
  currentStep++;
  onProgress({
    phase: 'analyzing',
    currentStep,
    totalSteps,
    message: `Analyzing test coverage for ${allItems.length} items...`,
    itemsCollected,
  });

  linkTestScenarios(allItems, scoreDefinitions);

  const stats = calculateStats(allItems);

  return {
    stats,
    items: allItems,
    collectionDate: new Date().toISOString(),
  };
}

// Export helpers for generating downloadable files

export function generateCoverageCSV(items: ContentItem[]): string {
  const headers = ['Name', 'Type', 'Has Test', 'Test Count', 'Created By', 'Created', 'Modified By', 'Modified', 'ID', 'URI'];
  const rows = items.map(item => [
    `"${(item.name ?? '').replace(/"/g, '""')}"`,
    item.contentType,
    item.hasTestScenario ? 'Yes' : 'No',
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

export function generateCoverageMarkdown(result: CoverageResult): string {
  const { stats, items } = result;
  const lines: string[] = [];

  lines.push(`# Test Coverage Report`);
  lines.push('');
  lines.push(`**Generated:** ${new Date(result.collectionDate).toLocaleString()}`);
  lines.push('');

  // Overall summary
  lines.push('## Overall Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total Assets | ${stats.overall.totalItems} |`);
  lines.push(`| With Tests | ${stats.overall.itemsWithTests} |`);
  lines.push(`| Without Tests | ${stats.overall.itemsWithoutTests} |`);
  lines.push(`| **Coverage** | **${stats.overall.coveragePercentage}%** |`);
  lines.push('');

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
    if (s.total > 0) {
      lines.push(`| ${label} | ${s.total} | ${s.withTests} | ${s.withoutTests} | ${s.coveragePercentage}% |`);
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
    lines.push('## Assets Without Test Coverage');
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
