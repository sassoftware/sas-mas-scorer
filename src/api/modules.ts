// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { apiClient, sasViyaClient, SAS_CONTENT_TYPES } from './client';
import { fetchAllPaginated, paginateCollection } from './paginate';
import { getDecision, getDecisionRevision } from './decisions';
import {
  cachedRequest,
  CACHE_FRESH_MS,
  invalidateRequestCache,
  type RequestOptions,
} from './requestCache';
import {
  Module,
  ModuleCollection,
  ModuleDefinition,
  ModuleSource,
  SubmoduleCollection,
  Submodule,
} from '../types';

// Entry types for Reference Data domains
export interface Entry {
  key: string;
  value: string;
}

export interface EntriesResponse {
  items: Entry[];
  count?: number;
}

export interface GetModulesParams {
  start?: number;
  limit?: number;
  filter?: string;
  sortBy?: string;
}

export const getModules = async (params: GetModulesParams = {}): Promise<ModuleCollection> => {
  const response = await apiClient.get<ModuleCollection>('/modules', {
    params: {
      start: params.start ?? 0,
      limit: params.limit ?? 20,
      filter: params.filter,
      sortBy: params.sortBy,
    },
    headers: {
      Accept: SAS_CONTENT_TYPES.COLLECTION,
    },
  });
  return response.data;
};

/**
 * Every module matching `filter`/`sortBy`, for client-side filtering that the
 * MAS filter grammar cannot express (module type is derived from stepsIds).
 * One request when the service honours the large page; continues correctly
 * when it caps the page instead.
 */
const ALL_MODULES_PAGE_SIZE = 10000;

export const getAllModules = async (
  params: Pick<GetModulesParams, 'filter' | 'sortBy'> = {}
): Promise<Module[]> => {
  return fetchAllPaginated<Module>('/modules', {
    client: apiClient,
    params: { filter: params.filter, sortBy: params.sortBy },
    headers: { Accept: SAS_CONTENT_TYPES.COLLECTION },
    pageSize: ALL_MODULES_PAGE_SIZE,
  });
};

/**
 * Module metadata is small, so it is kept only briefly: long enough that the
 * module page, a step page and the UI builder opened from it share one read,
 * short enough that a module republished from elsewhere shows up quickly.
 * No stale answers are served (see requestCache.ts).
 */
const MODULE_METADATA_POLICY = { freshMs: CACHE_FRESH_MS, maxEntries: 100 };

const moduleCacheKey = (moduleId: string): string => `module:${moduleId}`;

/** Forget the cached copy of a module (and its publish record lookups). */
export const invalidateModuleCache = (moduleId?: string): void => {
  invalidateRequestCache(moduleId ? moduleCacheKey(moduleId) : 'module:');
  invalidateRequestCache('publishedModel:');
};

/** The module. Cached for a minute, see requestCache.ts; `{ refresh: true }` skips that. */
export const getModule = async (moduleId: string, options?: RequestOptions): Promise<Module> => {
  return cachedRequest(
    moduleCacheKey(moduleId),
    async () => {
      const response = await apiClient.get<Module>(`/modules/${moduleId}`, {
        headers: {
          Accept: SAS_CONTENT_TYPES.MODULE,
        },
      });
      return response.data;
    },
    MODULE_METADATA_POLICY,
    options
  );
};

export const createModule = async (definition: ModuleDefinition): Promise<Module> => {
  const response = await apiClient.post<Module>('/modules', definition, {
    headers: {
      'Content-Type': SAS_CONTENT_TYPES.MODULE_DEFINITION,
      Accept: SAS_CONTENT_TYPES.MODULE,
    },
  });
  // A module created under an existing id replaces it.
  invalidateModuleCache(response.data?.id);
  return response.data;
};

export const updateModule = async (
  moduleId: string,
  module: Module,
  etag?: string
): Promise<Module> => {
  const headers: Record<string, string> = {
    'Content-Type': SAS_CONTENT_TYPES.MODULE,
    Accept: SAS_CONTENT_TYPES.MODULE,
  };
  if (etag) {
    headers['If-Match'] = etag;
  }

  try {
    const response = await apiClient.put<Module>(`/modules/${moduleId}`, module, { headers });
    return response.data;
  } finally {
    invalidateModuleCache(moduleId);
  }
};

export const deleteModule = async (moduleId: string): Promise<void> => {
  try {
    await apiClient.delete(`/modules/${moduleId}`);
  } finally {
    invalidateModuleCache(moduleId);
  }
};

export const getModuleSource = async (moduleId: string): Promise<ModuleSource> => {
  const response = await apiClient.get<ModuleSource>(`/modules/${moduleId}/source`, {
    headers: {
      Accept: SAS_CONTENT_TYPES.MODULE_SOURCE,
    },
  });
  return response.data;
};

export const updateModuleSource = async (
  moduleId: string,
  source: ModuleSource,
  etag?: string
): Promise<ModuleSource> => {
  const headers: Record<string, string> = {
    'Content-Type': SAS_CONTENT_TYPES.MODULE_SOURCE,
    Accept: SAS_CONTENT_TYPES.MODULE_SOURCE,
  };
  if (etag) {
    headers['If-Match'] = etag;
  }

  try {
    const response = await apiClient.put<ModuleSource>(
      `/modules/${moduleId}/source`,
      source,
      { headers }
    );
    return response.data;
  } finally {
    // New source recompiles the module: its steps and signature change.
    invalidateModuleCache(moduleId);
  }
};

export const getSubmodules = async (
  moduleId: string,
  start = 0,
  limit = 20
): Promise<SubmoduleCollection> => {
  const response = await apiClient.get<SubmoduleCollection>(
    `/modules/${moduleId}/submodules`,
    {
      params: { start, limit },
      headers: {
        Accept: SAS_CONTENT_TYPES.COLLECTION,
      },
    }
  );
  return response.data;
};

/**
 * All submodules of a module. `getSubmodules` returns one page (the service
 * default would be 10, our default 20), which a decision flow published to
 * MAS routinely exceeds; this walks the whole collection.
 */
export const getAllSubmodules = async (moduleId: string): Promise<Submodule[]> => {
  return fetchAllPaginated<Submodule>(`/modules/${moduleId}/submodules`, {
    client: apiClient,
    headers: { Accept: SAS_CONTENT_TYPES.COLLECTION },
  });
};

export const getSubmodule = async (
  moduleId: string,
  submoduleId: string
): Promise<Submodule> => {
  const response = await apiClient.get<Submodule>(
    `/modules/${moduleId}/submodules/${submoduleId}`,
    {
      headers: {
        Accept: SAS_CONTENT_TYPES.SUBMODULE,
      },
    }
  );
  return response.data;
};

export const getSubmoduleSource = async (
  moduleId: string,
  submoduleId: string
): Promise<ModuleSource> => {
  const response = await apiClient.get<ModuleSource>(
    `/modules/${moduleId}/submodules/${submoduleId}/source`,
    {
      headers: {
        Accept: SAS_CONTENT_TYPES.MODULE_SOURCE,
      },
    }
  );
  return response.data;
};

// Decision source info (from sourceURI for decision flow revisions)
export interface DecisionSourceInfo {
  majorRevision: number;
  minorRevision: number;
  description?: string;
}

// The published revision document, shared through the request cache with
// every other read of the same URI (Module Details and the step page both
// ask; the second asks no server). This is a different document from the
// current flow that getDecisionSignature reads — the two can disagree once the
// flow has been edited since publishing, so they are never merged.
export const getDecisionSourceInfo = async (
  sourceURI: string,
  options?: RequestOptions
): Promise<DecisionSourceInfo> => {
  const revision = await getDecisionRevision(sourceURI, options);
  return {
    majorRevision: revision.majorRevision,
    minorRevision: revision.minorRevision,
    description: revision.description,
  };
};

// Fixed column declared on a decision dataGrid variable (dataGridExtension)
export interface DecisionDataGridColumn {
  id?: string;
  name: string;
  dataType: string;
  length?: number;
  autoPopulate?: boolean;
}

// Decision signature variable (original variable names with correct casing)
export interface DecisionSignatureVariable {
  name: string;
  direction: 'input' | 'output';
  dataType: string;
  // Only meaningful when dataType is 'dataGrid'
  dataGridExtension?: DecisionDataGridColumn[] | null;
  dataGridMaxRowCount?: number | null;
  generateDataGridColumns?: boolean;
}

export const getDecisionSignature = async (
  sourceURI: string,
  options?: RequestOptions
): Promise<DecisionSignatureVariable[]> => {
  // sourceURI is like /decisions/flows/{id}/revisions/{revId} — extract the flow ID
  const flowMatch = sourceURI.match(/\/decisions\/flows\/([a-f0-9-]+)/);
  if (!flowMatch) return [];

  // The current flow (not the published revision), through the request cache
  // it shares with the Flows view.
  const flowId = flowMatch[1];
  const flow = await getDecision(flowId, options);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((flow.signature ?? []) as any[]).map((s: any) => ({
    name: s.name,
    direction: s.direction,
    dataType: s.dataType,
    dataGridExtension: Array.isArray(s.dataGridExtension)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? s.dataGridExtension.map((c: any) => ({
          id: c.id,
          name: c.name,
          dataType: c.dataType,
          length: c.length,
          autoPopulate: c.autoPopulate,
        }))
      : null,
    dataGridMaxRowCount: typeof s.dataGridMaxRowCount === 'number' ? s.dataGridMaxRowCount : null,
    generateDataGridColumns: s.generateDataGridColumns === true,
  }));
};

// Published model info (to get modelVersionId for Model type modules)
export interface PublishedModelInfo {
  modelVersionId: string;
  modelId: string;
}

// Page size for the case-insensitive fallback below: enough to reach the one
// record whose name matches exactly among the substring hits.
const PUBLISH_FALLBACK_LIMIT = 50;

// The newest MAS publish record whose publishName is exactly the module name.
//
// contains() on modelPublish is a substring AND case-insensitive match, so a
// module "credit" used to pick up "credit_v2" when that was published later,
// and the wrong version showed in Module Details, the Model Manager link and
// every batch CSV. eq() is tried first; when it finds nothing (eq may be case
// sensitive while MAS module names are lowercased), the contains() hits are
// narrowed to the one whose name matches ignoring case — never a substring.
// Single quotes are doubled for the filter language: an unescaped "o'brien"
// is a 400, not an empty result.
//
// Kept for a minute like the module itself (see requestCache.ts), so Module
// Details and the step page opened from it share one lookup.
export const getPublishedModelInfo = async (
  publishName: string,
  options?: RequestOptions
): Promise<PublishedModelInfo | null> =>
  cachedRequest(
    `publishedModel:${publishName}`,
    () => findPublishedModelInfo(publishName),
    MODULE_METADATA_POLICY,
    options
  );

const findPublishedModelInfo = async (publishName: string): Promise<PublishedModelInfo | null> => {
  const quoted = `'${publishName.replace(/'/g, "''")}'`;
  const fetchRecords = async (nameFilter: string, limit: number) => {
    const response = await sasViyaClient.get('/modelPublish/models', {
      params: {
        filter: `and(${nameFilter},eq(publishType,'mas'))`,
        sortBy: 'creationTimeStamp:descending',
        limit,
      },
      headers: {
        Accept: 'application/json',
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.items ?? []) as any[];
  };

  let match = (await fetchRecords(`eq(publishName,${quoted})`, 1))[0];
  if (!match) {
    const wanted = publishName.toLowerCase();
    const candidates = await fetchRecords(`contains(publishName,${quoted})`, PUBLISH_FALLBACK_LIMIT);
    match = candidates.find(item => String(item.publishName ?? '').toLowerCase() === wanted);
  }
  if (!match) return null;
  return {
    modelVersionId: match.modelVersionId,
    modelId: match.modelId,
  };
};

// Fetch entries for Reference Data domains (Data type modules). The entries
// collection defaults to 10 items, so it is walked page by page; `count` is
// the total the service reported (or the number of items received when it
// reports none), so a caller can tell when the walk hit the page cap.
export const getEntries = async (sourceURI: string): Promise<EntriesResponse> => {
  // sourceURI is a relative path like /referenceData/domains/{id}
  // We need to append /entries to get the entries
  const entriesPath = `${sourceURI}/entries`;
  const result = await paginateCollection<Entry>(entriesPath, {
    headers: { Accept: 'application/json' },
  });
  return {
    items: result.items,
    count: result.total ?? result.items.length,
  };
};
