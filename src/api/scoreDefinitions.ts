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
