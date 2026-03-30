// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import type { DecisionFlow, SidPaginatedResponse } from '../types/sid';

export async function listDecisions(
  search?: string,
  start = 0,
  limit = 20,
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
