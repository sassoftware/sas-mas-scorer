// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';
import {
  cachedRequest,
  IN_FLIGHT_ONLY,
  sidDocumentPolicy,
  type RequestOptions,
} from './requestCache';
import type { DecisionFlow, SidPaginatedResponse, WorkflowHistoryResponse } from '../types/sid';

const DECISION_ACCEPT = 'application/vnd.sas.decision+json';

/** Decision documents (current flows and revisions) kept for the session. */
const MAX_CACHED_DECISIONS = 300;

/**
 * 200 decisions are about 180 KB; the walker reads further pages a few at a
 * time once the first page has reported the total.
 */
const DECISIONS_PAGE_SIZE = 200;

/**
 * Request-cache key of a decision document by the URI it is read from:
 * `/decisions/flows/{id}` for the current flow, `…/revisions/{revId}` for a
 * revision. The two are different documents and are kept apart.
 */
export const decisionCacheKey = (uri: string): string => `decision:${uri}`;

/** The current decision behind a flow id, as `getDecision` reads it. */
export const decisionUri = (id: string): string => `/decisions/flows/${id}`;

function getDecisionDocument(uri: string, options?: RequestOptions): Promise<DecisionFlow> {
  return cachedRequest(
    decisionCacheKey(uri),
    async () => {
      const response = await sasViyaClient.get<DecisionFlow>(uri, {
        headers: { Accept: DECISION_ACCEPT },
      });
      return response.data;
    },
    sidDocumentPolicy<DecisionFlow>(uri, MAX_CACHED_DECISIONS),
    options,
  );
}

export async function listDecisions(
  search?: string,
  start = 0,
  limit = 100,
  sortBy = 'name:ascending',
): Promise<SidPaginatedResponse<DecisionFlow>> {
  const params = new URLSearchParams({
    start: String(start),
    limit: String(limit),
    sortBy,
  });
  if (search) {
    params.set('filter', `contains(name,'${search}')`);
  }
  const response = await sasViyaClient.get<SidPaginatedResponse<DecisionFlow>>(
    `/decisions/flows?${params.toString()}`,
    { headers: { Accept: 'application/vnd.sas.collection+json' } },
  );
  return response.data;
}

/**
 * Fetch all decisions, paging until the service reports the collection
 * exhausted. Identical calls running at the same time share one walk; the
 * result is not kept here (the Flows list keeps its own copy).
 */
export async function listAllDecisions(
  search?: string,
  sortBy = 'name:ascending',
): Promise<DecisionFlow[]> {
  return cachedRequest(
    `decisionList:${sortBy}|${search ?? ''}`,
    () =>
      fetchAllPaginated<DecisionFlow>('/decisions/flows', {
        params: {
          sortBy,
          filter: search ? `contains(name,'${search}')` : undefined,
        },
        pageSize: DECISIONS_PAGE_SIZE,
      }),
    IN_FLIGHT_ONLY,
  );
}

/** The current decision. Cached for the session, see requestCache.ts. */
export async function getDecision(id: string, options?: RequestOptions): Promise<DecisionFlow> {
  return getDecisionDocument(decisionUri(id), options);
}

/** A decision revision (or any decision URI). Cached for the session, see requestCache.ts. */
export async function getDecisionRevision(uri: string, options?: RequestOptions): Promise<DecisionFlow> {
  return getDecisionDocument(uri, options);
}

export async function getWorkflowHistory(decisionId: string): Promise<WorkflowHistoryResponse> {
  const response = await sasViyaClient.get<WorkflowHistoryResponse>(
    `/decisions/flows/${decisionId}/workflows/history`,
  );
  return response.data;
}
