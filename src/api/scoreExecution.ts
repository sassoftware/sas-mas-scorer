// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

// Runs a saved score definition (an Intelligent Decisioning test) the way the
// SID test tab does. The service fills in the hints itself from the
// definition, so the request needs nothing but the definition id.

export type ScoreExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | string;

export interface ScoreExecution {
  id: string;
  state: ScoreExecutionState;
  outputTable?: {
    tableName: string;
    libraryName: string;
    serverName: string;
  };
  logFileUri?: string;
  error?: { message?: string };
  results?: Record<string, string>;
}

const EXECUTION_MEDIA_TYPE = 'application/vnd.sas.score.execution+json';

export async function createScoreExecution(
  scoreDefinitionId: string,
  name: string
): Promise<ScoreExecution> {
  const response = await sasViyaClient.post<ScoreExecution>(
    '/scoreExecution/executions',
    { type: 'scoreDefinition', name, scoreDefinitionId },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: EXECUTION_MEDIA_TYPE,
      },
    }
  );
  return response.data;
}

export async function getScoreExecution(id: string): Promise<ScoreExecution> {
  const response = await sasViyaClient.get<ScoreExecution>(
    `/scoreExecution/executions/${encodeURIComponent(id)}`,
    { headers: { Accept: EXECUTION_MEDIA_TYPE } }
  );
  return response.data;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

const isFinished = (state: ScoreExecutionState): boolean =>
  state !== 'pending' && state !== 'running';

/**
 * Poll an execution until it leaves pending/running. `shouldStop` lets the
 * caller abandon the wait (the dialog was closed); the execution itself keeps
 * running on the server either way.
 */
export async function waitForScoreExecution(
  id: string,
  shouldStop: () => boolean = () => false
): Promise<ScoreExecution> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const execution = await getScoreExecution(id);
    if (isFinished(execution.state)) return execution;
    if (shouldStop()) return execution;
    if (Date.now() > deadline) {
      throw new Error('The test is still running after 15 minutes; check it in SAS Intelligent Decisioning.');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
