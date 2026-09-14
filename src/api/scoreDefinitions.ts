// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';

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
    type: string; // 'decision' | 'codeFile' | ...
    uri: string;
  };
  mappings: ScoreDefinitionMapping[];
}

export interface TestScoreDefinitionPayload {
  name: string;
  description?: string;
  inputData: {
    type: 'CASTable';
    serverName: string;
    libraryName: string;
    tableName: string;
  };
  properties: {
    outputLibraryName: string;
    outputServerName: string;
    tableBaseName: string;
    test: 'true';
    version: string;
  };
  objectDescriptor: {
    name: string;
    type: string; // 'decision' | 'codeFile' | ...
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
  payload: ScoreDefinitionPayload | TestScoreDefinitionPayload,
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
 * Walks every page — a batch save creates one scenario per row, so a decision
 * can easily hold more than one page of them.
 */
export const listDecisionScenarios = async (
  decisionFlowId: string
): Promise<ScoreDefinitionSummary[]> => {
  const filter = `and(contains(objectDescriptor.uri,'/decisions/flows/${decisionFlowId}'),or(isNull(folderType),ne(folderType,'trashFolder')),eq(inputData.type,'Scenario'))`;

  return fetchAllPaginated<ScoreDefinitionSummary>('/scoreDefinitions/definitions', {
    params: { filter },
    headers: {
      Accept: 'application/vnd.sas.collection+json, application/json',
      'Accept-Item': 'application/vnd.sas.score.definition+json',
    },
    pageSize: 100,
  });
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
