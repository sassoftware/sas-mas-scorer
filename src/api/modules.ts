// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { apiClient, sasViyaClient, SAS_CONTENT_TYPES } from './client';
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

export const getModule = async (moduleId: string): Promise<Module> => {
  const response = await apiClient.get<Module>(`/modules/${moduleId}`, {
    headers: {
      Accept: SAS_CONTENT_TYPES.MODULE,
    },
  });
  return response.data;
};

export const createModule = async (definition: ModuleDefinition): Promise<Module> => {
  const response = await apiClient.post<Module>('/modules', definition, {
    headers: {
      'Content-Type': SAS_CONTENT_TYPES.MODULE_DEFINITION,
      Accept: SAS_CONTENT_TYPES.MODULE,
    },
  });
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

  const response = await apiClient.put<Module>(`/modules/${moduleId}`, module, { headers });
  return response.data;
};

export const deleteModule = async (moduleId: string): Promise<void> => {
  await apiClient.delete(`/modules/${moduleId}`);
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

  const response = await apiClient.put<ModuleSource>(
    `/modules/${moduleId}/source`,
    source,
    { headers }
  );
  return response.data;
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

export const getDecisionSourceInfo = async (sourceURI: string): Promise<DecisionSourceInfo> => {
  const response = await sasViyaClient.get<DecisionSourceInfo>(sourceURI, {
    headers: {
      Accept: 'application/vnd.sas.decision+json',
    },
  });
  return {
    majorRevision: response.data.majorRevision,
    minorRevision: response.data.minorRevision,
    description: response.data.description,
  };
};

// Decision signature variable (original variable names with correct casing)
export interface DecisionSignatureVariable {
  name: string;
  direction: 'input' | 'output';
  dataType: string;
}

export const getDecisionSignature = async (sourceURI: string): Promise<DecisionSignatureVariable[]> => {
  // sourceURI is like /decisions/flows/{id}/revisions/{revId} — extract the flow ID
  const flowMatch = sourceURI.match(/\/decisions\/flows\/([a-f0-9-]+)/);
  if (!flowMatch) return [];

  const flowId = flowMatch[1];
  const response = await sasViyaClient.get(`/decisions/flows/${flowId}`, {
    headers: {
      Accept: 'application/vnd.sas.decision+json',
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response.data.signature ?? []).map((s: any) => ({
    name: s.name,
    direction: s.direction,
    dataType: s.dataType,
  }));
};

// Published model info (to get modelVersionId for Model type modules)
export interface PublishedModelInfo {
  modelVersionId: string;
  modelId: string;
}

export const getPublishedModelInfo = async (publishName: string): Promise<PublishedModelInfo | null> => {
  const response = await sasViyaClient.get('/modelPublish/models', {
    params: {
      filter: `and(contains(publishName,'${publishName}'),eq(publishType,'mas'))`,
      sortBy: 'creationTimeStamp:descending',
      limit: 1,
    },
    headers: {
      Accept: 'application/json',
    },
  });
  const items = response.data.items ?? [];
  if (items.length === 0) return null;
  return {
    modelVersionId: items[0].modelVersionId,
    modelId: items[0].modelId,
  };
};

// Fetch entries for Reference Data domains (Data type modules)
export const getEntries = async (sourceURI: string): Promise<EntriesResponse> => {
  // sourceURI is a relative path like /referenceData/domains/{id}
  // We need to append /entries to get the entries
  const entriesPath = `${sourceURI}/entries`;
  const response = await sasViyaClient.get<EntriesResponse>(entriesPath, {
    headers: {
      Accept: 'application/json',
    },
  });
  return response.data;
};
