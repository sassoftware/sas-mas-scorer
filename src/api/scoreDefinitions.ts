// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

// --- Types ---

export interface ScoreDefinitionMapping {
  variableName: string;
  mappingType: 'static' | 'expected' | 'datasource';
  mappingValue: unknown;
}

export interface ScoreDefinitionPayload {
  name: string;
  description?: string;
  inputData: { type: 'Scenario' };
  properties: {
    outputLibraryName: string;
    outputServerName: string;
    tableBaseName: string;
    version: string;
    outputTableName: string;
  };
  objectDescriptor: {
    name: string;
    type: 'decision';
    uri: string;
  };
  mappings: ScoreDefinitionMapping[];
}

export interface ScoreDefinitionResponse {
  id: string;
  name: string;
  createdBy: string;
  creationTimeStamp: string;
}

// Summary item returned by the collection endpoint
export interface ScoreDefinitionSummary {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  creationTimeStamp: string;
  modifiedBy: string;
  modifiedTimeStamp: string;
}

// Full score definition detail (individual GET)
export interface ScoreDefinitionDetail {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  creationTimeStamp: string;
  objectDescriptor?: {
    name: string;
    type: string;
    uri: string;
  };
  inputData?: { type: string };
  mappings: ScoreDefinitionMapping[];
  properties?: Record<string, string>;
}

// --- API ---

export const createScoreDefinition = async (
  payload: ScoreDefinitionPayload,
  parentFolderUri: string
): Promise<ScoreDefinitionResponse> => {
  const response = await sasViyaClient.post(
    '/scoreDefinitions/definitions',
    payload,
    {
      params: { parentFolderUri },
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }
  );
  return response.data;
};

/**
 * List scenario-type score definitions for a specific decision flow.
 * Uses the advanced filter to find Scenario input types that aren't trashed.
 */
export const listDecisionScenarios = async (
  decisionFlowId: string
): Promise<ScoreDefinitionSummary[]> => {
  const filter = `and(contains(objectDescriptor.uri,'/decisions/flows/${decisionFlowId}'),or(isNull(folderType),ne(folderType,'trashFolder')),eq(inputData.type,'Scenario'))`;

  const response = await sasViyaClient.get('/scoreDefinitions/definitions', {
    params: { filter, limit: 100 },
    headers: {
      Accept: 'application/vnd.sas.collection+json, application/json',
      'Accept-Item': 'application/vnd.sas.score.definition+json',
    },
  });

  return response.data.items ?? [];
};

/**
 * Fetch the full detail of a single score definition (including mappings).
 */
export const getScoreDefinition = async (
  id: string
): Promise<ScoreDefinitionDetail> => {
  const response = await sasViyaClient.get(`/scoreDefinitions/definitions/${id}`, {
    headers: { Accept: 'application/vnd.sas.score.definition+json' },
  });

  return response.data;
};
