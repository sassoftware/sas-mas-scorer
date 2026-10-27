// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// The tests and scenarios saved on a segmentation tree, and their runs.
//
// Verified against SAS Viya (2026-10):
// - Score definitions can be filtered server-side by
//   contains(objectDescriptor.uri,'/decisions/segmentationTrees/<id>') and
//   eq(inputData.type,'CASTable' | 'Scenario'). The collection items are
//   summaries: inputData, properties and objectDescriptor come back null, so
//   anything that needs them reads the definition itself.
// - A definition's objectDescriptor.uri pins a tree revision:
//   /decisions/segmentationTrees/<id>/revisions/<revisionId>.
// - Executions of a definition are found with
//   eq(scoreExecutionRequest.scoreDefinitionId,'<id>'); a filter on plain
//   scoreDefinitionId is rejected with HTTP 400.

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';
import { getScoreDefinition, type ScoreDefinitionDetail } from './scoreDefinitions';
import { getScoreExecution, type ScoreExecution } from './scoreExecution';

const DEFINITION_MEDIA_TYPE = 'application/vnd.sas.score.definition+json';
/** Definitions read at once when the list leaves out their details. */
const DETAIL_CONCURRENCY = 4;
/**
 * Scenarios whose details are read to show their revision. A whole-tree save
 * can create one scenario per path (thousands); past this many they are
 * listed by name only.
 */
export const SCENARIO_DETAIL_LIMIT = 50;

export type TreeTestKind = 'table' | 'scenario';

export interface TreeTestDefinition {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  kind: TreeTestKind;
  /** objectDescriptor.uri; null when its details were not read. */
  targetUri: string | null;
  /** The tree revision the definition is pinned to; null when the uri names none (or was not read). */
  revisionId: string | null;
  /** The CAS table a table test reads. */
  inputTable?: { serverName?: string; libraryName?: string; tableName?: string };
  /** False when the details were not read (a scenario past SCENARIO_DETAIL_LIMIT). */
  detailLoaded: boolean;
}

export interface TreeTestList {
  tests: TreeTestDefinition[];
  scenarios: TreeTestDefinition[];
}

interface DefinitionItem extends Partial<ScoreDefinitionDetail> {
  id: string;
  name: string;
  modifiedTimeStamp?: string;
  inputData?: { type: string; serverName?: string; libraryName?: string; tableName?: string };
}

const REVISION_RE = /\/revisions\/([^/?#]+)/;

/** The revision id in a `/decisions/segmentationTrees/<id>/revisions/<rev>` uri, or null. */
export function revisionOfUri(uri: string | null | undefined): string | null {
  const m = uri ? REVISION_RE.exec(uri) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

function toDefinition(item: DefinitionItem, kind: TreeTestKind, detailLoaded: boolean): TreeTestDefinition {
  const uri = item.objectDescriptor?.uri ?? null;
  const input = item.inputData;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    createdBy: item.createdBy,
    creationTimeStamp: item.creationTimeStamp,
    modifiedTimeStamp: item.modifiedTimeStamp,
    kind,
    targetUri: uri,
    revisionId: revisionOfUri(uri),
    inputTable: input && input.type === 'CASTable'
      ? { serverName: input.serverName, libraryName: input.libraryName, tableName: input.tableName }
      : undefined,
    detailLoaded,
  };
}

/** Run `work` over `items`, a few at a time, keeping the order. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function listDefinitions(treeId: string, inputType: 'CASTable' | 'Scenario'): Promise<DefinitionItem[]> {
  const filter =
    `and(contains(objectDescriptor.uri,'/decisions/segmentationTrees/${treeId}'),` +
    `or(isNull(folderType),ne(folderType,'trashFolder')),eq(inputData.type,'${inputType}'))`;
  return fetchAllPaginated<DefinitionItem>('/scoreDefinitions/definitions', {
    params: { filter, sortBy: 'modifiedTimeStamp:descending' },
    headers: {
      Accept: 'application/vnd.sas.collection+json, application/json',
      // Asks for full items; services that ignore it still send summaries, read one by one below.
      'Accept-Item': DEFINITION_MEDIA_TYPE,
    },
    pageSize: 100,
  });
}

/** The details a summary leaves out, read from the definition when missing. */
async function withDetail(item: DefinitionItem): Promise<DefinitionItem> {
  if (item.objectDescriptor?.uri && item.inputData?.type) return item;
  const detail = (await getScoreDefinition(item.id)) as DefinitionItem;
  return { ...item, ...detail };
}

/**
 * Table tests and scenarios saved on a tree (any revision), newest first.
 * Every table test's details are read; scenarios only up to
 * SCENARIO_DETAIL_LIMIT.
 */
export async function listTreeTests(treeId: string): Promise<TreeTestList> {
  const [testItems, scenarioItems] = await Promise.all([
    listDefinitions(treeId, 'CASTable'),
    listDefinitions(treeId, 'Scenario'),
  ]);
  const tests = await mapLimited(testItems, DETAIL_CONCURRENCY, async (item) => toDefinition(await withDetail(item), 'table', true));
  const detailed = await mapLimited(scenarioItems.slice(0, SCENARIO_DETAIL_LIMIT), DETAIL_CONCURRENCY, async (item) => {
    try {
      return toDefinition(await withDetail(item), 'scenario', true);
    } catch {
      // A scenario whose details cannot be read is still worth listing.
      return toDefinition(item, 'scenario', false);
    }
  });
  const rest = scenarioItems.slice(SCENARIO_DETAIL_LIMIT).map((item) => toDefinition(item, 'scenario', !!item.objectDescriptor?.uri));
  return { tests, scenarios: [...detailed, ...rest] };
}

interface RevisionItem {
  id: string;
  majorRevision?: number;
  minorRevision?: number;
}

/** Revision id → "major.minor" for a tree. Best effort: an empty map when the list cannot be read. */
export async function listTreeRevisionLabels(treeId: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const items = await fetchAllPaginated<RevisionItem>(
      `/decisions/segmentationTrees/${encodeURIComponent(treeId)}/revisions`,
      { pageSize: 100 }
    );
    for (const r of items) labels.set(r.id, `${r.majorRevision ?? 0}.${r.minorRevision ?? 0}`);
  } catch {
    /* labels are a nicety; the ids still tell revisions apart */
  }
  return labels;
}

export type TreeTestExecution = ScoreExecution & {
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
};

export interface LatestExecutions {
  /** The newest execution of the definition, whatever its state. */
  latest: TreeTestExecution | null;
  /** The newest one that completed with an output table. */
  latestCompleted: TreeTestExecution | null;
}

/** How many recent executions are looked through for one that completed. */
const RECENT_EXECUTIONS = 10;

/** The newest executions of a score definition. */
export async function latestTestExecutions(definitionId: string): Promise<LatestExecutions> {
  const response = await sasViyaClient.get<{ items?: TreeTestExecution[] }>('/scoreExecution/executions', {
    params: {
      filter: `eq(scoreExecutionRequest.scoreDefinitionId,'${definitionId}')`,
      sortBy: 'creationTimeStamp:descending',
      start: 0,
      limit: RECENT_EXECUTIONS,
    },
    headers: { Accept: 'application/vnd.sas.collection+json, application/json' },
  });
  const items = response.data.items ?? [];
  let latestCompleted: TreeTestExecution | null = null;
  let latest: TreeTestExecution | null = null;
  for (const item of items) {
    // Collection items may be summaries without the state or the output table.
    const full: TreeTestExecution = item.state && item.outputTable ? item : { ...item, ...(await getScoreExecution(item.id)) };
    latest ??= full;
    if (full.state === 'completed' && full.outputTable) {
      latestCompleted = full;
      break;
    }
  }
  return { latest, latestCompleted };
}

/**
 * Point a saved test at another tree revision (the current one), so a run
 * scores the tree as it is now. Reads the definition with its ETag and
 * replaces it; nothing but objectDescriptor changes.
 */
export async function retargetTreeTest(definitionId: string, revisionUri: string, treeName: string): Promise<void> {
  const url = `/scoreDefinitions/definitions/${encodeURIComponent(definitionId)}`;
  const current = await sasViyaClient.get<Record<string, unknown> & { objectDescriptor?: Record<string, unknown> }>(url, {
    headers: { Accept: DEFINITION_MEDIA_TYPE },
  });
  const etag = typeof current.headers?.etag === 'string' ? current.headers.etag : undefined;
  const body: Record<string, unknown> = { ...current.data };
  delete body.links;
  body.objectDescriptor = { ...(current.data.objectDescriptor ?? {}), uri: revisionUri, name: treeName, type: 'segmentationTree' };
  const headers: Record<string, string> = { 'Content-Type': DEFINITION_MEDIA_TYPE, Accept: DEFINITION_MEDIA_TYPE };
  if (etag) headers['If-Match'] = etag;
  await sasViyaClient.put(url, body, { headers });
}
