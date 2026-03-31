// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import type { DecisionFlow, SidPaginatedResponse, WorkflowHistoryResponse } from '../types/sid';

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

/** Fetch all decisions by paginating until fewer items than the limit are returned. */
export async function listAllDecisions(
  search?: string,
  sortBy = 'name:ascending',
): Promise<DecisionFlow[]> {
  const pageSize = 100;
  const all: DecisionFlow[] = [];
  let start = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await listDecisions(search, start, pageSize, sortBy);
    const items = page.items ?? [];
    all.push(...items);
    if (items.length < pageSize) break;
    start += pageSize;
  }

  return all;
}

export async function getDecision(id: string): Promise<DecisionFlow> {
  const response = await sasViyaClient.get<DecisionFlow>(
    `/decisions/flows/${id}`,
    { headers: { Accept: 'application/vnd.sas.decision+json' } },
  );
  return response.data;
}

export async function getDecisionRevision(uri: string): Promise<DecisionFlow> {
  const response = await sasViyaClient.get<DecisionFlow>(
    uri,
    { headers: { Accept: 'application/vnd.sas.decision+json' } },
  );
  return response.data;
}

export async function getWorkflowHistory(decisionId: string): Promise<WorkflowHistoryResponse> {
  const response = await sasViyaClient.get<WorkflowHistoryResponse>(
    `/decisions/flows/${decisionId}/workflows/history`,
  );
  return response.data;
}
