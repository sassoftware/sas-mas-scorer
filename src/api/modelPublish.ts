// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fetchAllPaginated, PageProgress } from './paginate';
import {
  cachedRequest,
  peekRequestCache,
  CACHE_FRESH_MS,
  CACHE_STALE_MS,
  type RequestOptions,
} from './requestCache';
import { getAllModules, getModule } from './modules';
import { extractDecisionFlowId } from '../utils/publishHelpers';
import {
  PublishDestination,
  PublishDestinationCollection,
  PublishedItem,
  PublishedItemCollection,
} from '../types/modelPublish';

/**
 * modelPublish honours a page size well above the usual 100, and each request
 * costs a couple of seconds, so a larger page is worth far more than a smaller
 * one: 424 items came back in one 2s request instead of five totalling ~16s.
 * (modelPublish does not send `count`, so `total` in the progress is null.)
 */
const PAGE_SIZE = 500;

export type { PageProgress };

export const getAllDestinations = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishDestination[]> => {
  return fetchAllPaginated<PublishDestination>('/modelPublish/destinations', {
    pageSize: PAGE_SIZE,
    onPage,
  });
};

export const getAllCompletedPublishedItems = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishedItem[]> => {
  return fetchAllPaginated<PublishedItem>('/modelPublish/models', {
    params: {
      filter: "eq(state,'completed')",
      sortBy: 'creationTimeStamp:descending',
    },
    pageSize: PAGE_SIZE,
    onPage,
  });
};

// --- Decision -> MAS module resolver -----------------------------------------
//
// A decision published to MAS becomes a module whose id is the publish
// record's publishName (the Publishing Overview opens the scorer with it), and
// the record's sourceUri points back at the flow revision that was published:
// /decisions/flows/{flowId}/revisions/{revisionId}. modelPublish is slow (about
// 2.4 s per request, close to 4 s for a single-flow filter), so the answers are
// cached, and a list asks once for every flow rather than once per row.
//
// A publish record outlives the module (a module can be deleted from MAS
// afterwards), so each module named by a record is also checked against MAS:
// one module listing for a list, one module GET per name for a single flow.
// Only a module that was found is offered for scoring.

/** One MAS module a decision was published as, per its publish record. */
export interface DecisionMasPublication {
  /** The MAS module id; the scorer route is #/modules/{publishName}. */
  publishName: string;
  /** The published flow revision URI (publish record sourceUri). */
  sourceUri: string;
  /** The published flow revision id, when the sourceUri names one. */
  revisionId: string | null;
  destinationName: string;
  /** When this module was (last) published (publish record creationTimeStamp). */
  publishedAt: string;
  publishedBy?: string;
}

/** Where a decision can be scored. */
export interface DecisionMasModules {
  /**
   * The most recently published module that exists in MAS (or, when the
   * check could not be made, the most recently published one); null when
   * every module the records name is gone.
   */
  latest: DecisionMasPublication | null;
  /** Other modules of the same flow, newest first (same rule as `latest`). */
  others: DecisionMasPublication[];
  /** Modules the publish records name but MAS no longer has. */
  removed: DecisionMasPublication[];
  /** False when MAS could not be asked, so `latest` is unchecked. */
  verified: boolean;
}

/** Flow id -> its MAS modules. A plain object, so the cache can compare answers. */
export type DecisionMasModuleIndex = Record<string, DecisionMasModules>;

const DECISION_MAS_KEY_ALL = 'decisionMasModules:all';
const decisionMasKey = (flowId: string) => `decisionMasModules:flow:${flowId}`;

// A publish record changes only when someone publishes, so a minute fresh and
// a quarter of an hour served-while-refreshed is plenty.
const DECISION_MAS_POLICY = { freshMs: CACHE_FRESH_MS, staleMs: CACHE_STALE_MS };

const decisionMasFilter = (flowId?: string): string => {
  const prefix = flowId ? `/decisions/flows/${flowId.replace(/'/g, "''")}` : '/decisions/flows/';
  return `and(contains(sourceUri,'${prefix}'),eq(publishType,'mas'))`;
};

const fetchDecisionMasRecords = (flowId?: string): Promise<PublishedItem[]> =>
  fetchAllPaginated<PublishedItem>('/modelPublish/models', {
    params: {
      filter: decisionMasFilter(flowId),
      sortBy: 'creationTimeStamp:descending',
    },
    pageSize: PAGE_SIZE,
  });

/** MAS module ids are compared without case (MAS lowercases them). */
const moduleKey = (id: string): string => id.toLowerCase();

/**
 * Group publish records by flow. Only completed publishes count: a pending
 * or failed one has no module behind it. Several records with the same
 * publishName are republishes of one module; the newest one is kept. When a
 * module name was later reused for another flow, the module now belongs to
 * that flow only (publishing replaces the module).
 *
 * `exists` answers whether MAS has the module: true, false, or undefined when
 * that is not known (then the module is offered, marked unverified).
 */
export function indexDecisionMasRecords(
  records: PublishedItem[],
  exists: (publishName: string) => boolean | undefined = () => undefined
): DecisionMasModuleIndex {
  const completed = records.filter((r) => r.state === 'completed' && !!r.publishName);
  // The flow each module name was last published from.
  const owner = new Map<string, { flowId: string | null; at: number }>();
  for (const record of completed) {
    const at = Date.parse(record.creationTimeStamp) || 0;
    const current = owner.get(moduleKey(record.publishName));
    if (!current || at > current.at) {
      owner.set(moduleKey(record.publishName), { flowId: extractDecisionFlowId(record.sourceUri), at });
    }
  }

  const byFlow = new Map<string, Map<string, DecisionMasPublication>>();
  for (const record of completed) {
    const flowId = extractDecisionFlowId(record.sourceUri);
    if (!flowId || owner.get(moduleKey(record.publishName))?.flowId !== flowId) continue;
    const publication: DecisionMasPublication = {
      publishName: record.publishName,
      sourceUri: record.sourceUri,
      revisionId: record.sourceUri.match(/\/revisions\/([^/?]+)/)?.[1] ?? null,
      destinationName: record.destinationName,
      publishedAt: record.creationTimeStamp,
      publishedBy: record.createdBy,
    };
    let modules = byFlow.get(flowId);
    if (!modules) {
      modules = new Map();
      byFlow.set(flowId, modules);
    }
    const key = moduleKey(publication.publishName);
    const existing = modules.get(key);
    if (!existing || (Date.parse(publication.publishedAt) || 0) > (Date.parse(existing.publishedAt) || 0)) {
      modules.set(key, publication);
    }
  }

  const index: DecisionMasModuleIndex = {};
  byFlow.forEach((modules, flowId) => {
    const sorted = [...modules.values()].sort(
      (a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)
    );
    const answers = sorted.map((p) => exists(p.publishName));
    const live = sorted.filter((_p, i) => answers[i] !== false);
    index[flowId] = {
      latest: live[0] ?? null,
      others: live.slice(1),
      removed: sorted.filter((_p, i) => answers[i] === false),
      verified: answers.every((a) => a !== undefined),
    };
  });
  return index;
}

const statusOf = (err: unknown): number | undefined => {
  const own = (err as { status?: unknown } | null)?.status;
  if (typeof own === 'number') return own;
  const nested = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof nested === 'number' ? nested : undefined;
};

/**
 * The MAS modules of every published decision, from one modelPublish query
 * plus one MAS module listing. For lists (the flow list, Test Coverage): look
 * rows up in the answer.
 */
export function findMasModulesForDecisions(options?: RequestOptions): Promise<DecisionMasModuleIndex> {
  return cachedRequest(
    DECISION_MAS_KEY_ALL,
    async () => {
      const [records, moduleIds] = await Promise.all([
        fetchDecisionMasRecords(),
        // A failed listing leaves the modules unverified rather than failing the lookup.
        getAllModules()
          .then((modules) => new Set(modules.map((m) => moduleKey(m.id))))
          .catch((err: unknown) => {
            console.warn('Could not list MAS modules to check published decisions:', err);
            return null;
          }),
      ]);
      return indexDecisionMasRecords(records, (name) => (moduleIds ? moduleIds.has(moduleKey(name)) : undefined));
    },
    DECISION_MAS_POLICY,
    options
  );
}

/**
 * The MAS module to score a decision in: the newest completed publish of the
 * flow whose module MAS still has, with the other modules it was published
 * as. Null when the flow was never published to MAS (or only has pending or
 * failed publishes). When the list answer is already cached it is used
 * instead of a second query.
 */
export async function findMasModuleForDecision(
  flowId: string,
  options: RequestOptions = {}
): Promise<DecisionMasModules | null> {
  if (!options.refresh && peekRequestCache<DecisionMasModuleIndex>(DECISION_MAS_KEY_ALL)) {
    const index = await findMasModulesForDecisions();
    return index[flowId] ?? null;
  }
  return cachedRequest(
    decisionMasKey(flowId),
    async () => {
      const records = await fetchDecisionMasRecords(flowId);
      const names = [...new Set(
        records.filter((r) => r.state === 'completed' && r.publishName).map((r) => r.publishName)
      )];
      // Usually one or two names; each GET also warms the scorer's module cache.
      const found = new Map<string, boolean | undefined>();
      await Promise.all(names.map(async (name) => {
        try {
          await getModule(name);
          found.set(moduleKey(name), true);
        } catch (err) {
          found.set(moduleKey(name), statusOf(err) === 404 ? false : undefined);
        }
      }));
      return indexDecisionMasRecords(records, (name) => found.get(moduleKey(name)))[flowId] ?? null;
    },
    DECISION_MAS_POLICY,
    options
  );
}

/** The scorer route for a MAS module (hash route, without the '#'). */
export const masModuleRoute = (publishName: string): string =>
  `/modules/${encodeURIComponent(publishName)}`;

// Re-exported for testing convenience
export type { PublishDestinationCollection, PublishedItemCollection };
