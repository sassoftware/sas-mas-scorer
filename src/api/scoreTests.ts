// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// The scorer's view of SAS Intelligent Decisioning tests (CAS-table score
// definitions): list a decision's tests, read one back, run it and read the
// size of what it wrote. Creating a definition and polling an execution stay
// in scoreDefinitions.ts / scoreExecution.ts, which this builds on.

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';
import { ScoreDefinitionMapping } from './scoreDefinitions';
import { ScoreExecution, createScoreExecution, waitForScoreExecution } from './scoreExecution';
import { getTableColumns, getTableRows } from './cas';

const DEFINITION_MEDIA_TYPE = 'application/vnd.sas.score.definition+json';

/** A CAS-table test definition as the service returns it. */
export interface ScoreTestDefinition {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  creationTimeStamp?: string;
  modifiedBy?: string;
  modifiedTimeStamp?: string;
  objectDescriptor?: {
    name?: string;
    type?: string;
    uri?: string;
  };
  inputData?: {
    type: string;
    serverName?: string;
    libraryName?: string;
    tableName?: string;
  };
  mappings?: ScoreDefinitionMapping[];
  properties?: Record<string, string>;
}

/** The flow id of a decision source URI ('/decisions/flows/<id>[/...]'). */
export const decisionFlowIdOf = (sourceURI: string): string | null =>
  sourceURI.match(/\/decisions\/flows\/([A-Za-z0-9-]+)/)?.[1] ?? null;

/**
 * Whether a definition belongs to this decision flow. The service's filter
 * already narrows by URI, but `contains` also matches longer ids and the
 * listing can carry publish and model-pipeline validations, so the result is
 * checked again here.
 */
// Only fields the item carries are checked (the server filter has already
// applied them); a field that is present and says otherwise drops the item.
const isTestOfFlow = (def: ScoreTestDefinition, flowId: string): boolean => {
  const type = (def.objectDescriptor?.type ?? '').toLowerCase();
  if (type.includes('validation')) return false;
  if (def.inputData && def.inputData.type !== 'CASTable') return false;
  if (def.properties && def.properties.test !== undefined && def.properties.test !== 'true') return false;
  const uri = def.objectDescriptor?.uri;
  if (uri === undefined) return true;
  return uri.match(/\/decisions\/flows\/([A-Za-z0-9-]+)/)?.[1] === flowId;
};

/**
 * The CAS-table tests of a decision flow, newest first. Only definitions that
 * are tests (properties.test = 'true'), read a CAS table and point at this
 * decision are kept: the bare inputData filter also returns publish
 * validations, model pipeline validations and segmentation-tree tests.
 */
export const listDecisionTests = async (sourceURI: string): Promise<ScoreTestDefinition[]> => {
  const flowId = decisionFlowIdOf(sourceURI);
  if (!flowId) throw new Error('This module does not come from a decision flow.');
  const filter =
    `and(eq(inputData.type,'CASTable'),eq(properties.test,'true'),` +
    `contains(objectDescriptor.uri,'/decisions/flows/${flowId}'),` +
    `or(isNull(folderType),ne(folderType,'trashFolder')))`;
  const items = await fetchAllPaginated<ScoreTestDefinition>('/scoreDefinitions/definitions', {
    params: { filter, sortBy: 'modifiedTimeStamp:descending' },
    headers: {
      Accept: 'application/vnd.sas.collection+json, application/json',
      'Accept-Item': DEFINITION_MEDIA_TYPE,
    },
    pageSize: 100,
  });
  return items.filter(def => isTestOfFlow(def, flowId));
};

/** One test definition with its input table and mappings. */
export const getScoreTest = async (id: string): Promise<ScoreTestDefinition> => {
  const response = await sasViyaClient.get<ScoreTestDefinition>(
    `/scoreDefinitions/definitions/${encodeURIComponent(id)}`,
    { headers: { Accept: DEFINITION_MEDIA_TYPE } }
  );
  return response.data;
};

/** Summary of one past execution of a definition. */
export interface ScoreExecutionSummary {
  id: string;
  name?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
}

/**
 * The most recent execution of a definition, or null. The service rejects a
 * filter on `scoreDefinitionId` (400, code 1020); the request field is the one
 * that filters. Listing items carry no state or output table.
 */
export const getLastScoreTestExecution = async (
  definitionId: string
): Promise<ScoreExecutionSummary | null> => {
  const response = await sasViyaClient.get<{ items?: ScoreExecutionSummary[] }>(
    '/scoreExecution/executions',
    {
      params: {
        filter: `eq(scoreExecutionRequest.scoreDefinitionId,'${definitionId}')`,
        sortBy: 'creationTimeStamp:descending',
        limit: 1,
      },
      headers: { Accept: 'application/vnd.sas.collection+json, application/json' },
    }
  );
  return response.data.items?.[0] ?? null;
};

/** Size of a finished test's output table; null fields could not be read. */
export interface OutputTableSize {
  rows: number | null;
  columns: number | null;
}

export const getOutputTableSize = async (
  table: NonNullable<ScoreExecution['outputTable']>
): Promise<OutputTableSize> => {
  const [rows, columns] = await Promise.allSettled([
    getTableRows(table.serverName, table.libraryName, table.tableName, 0, 1),
    getTableColumns(table.serverName, table.libraryName, table.tableName),
  ]);
  return {
    rows: rows.status === 'fulfilled' ? rows.value.count : null,
    columns: columns.status === 'fulfilled' ? columns.value.length : null,
  };
};

/**
 * Run a saved test and wait for it to finish (or for `shouldStop`, which
 * stops waiting; the run itself continues on the server). The execution id
 * from the create call is the one polled: past runs cannot be looked up by
 * definition.
 */
export const runScoreTest = async (
  definitionId: string,
  name: string,
  shouldStop: () => boolean = () => false
): Promise<ScoreExecution> => {
  const execution = await createScoreExecution(definitionId, `Execution for ${name}`);
  return waitForScoreExecution(execution.id, shouldStop);
};
