// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Running a saved table test and reading its results, shared by the test
// dialog (a test it just created) and the Tests dialog (a saved test).

import { createScoreExecution, waitForScoreExecution, type ScoreExecution } from '../../api/scoreExecution';
import { getFileText } from '../../api/files';
import { getAllTableRows, getTableColumns } from '../../api/cas';
import { logExcerpt, type LogExcerpt } from '../../utils/segTree/runLog';
import { compareResults, expectedVariables, type TestRunResults } from '../../utils/segTree/testRows';

/** Why a test run did not complete, with what its log says. */
export interface RunFailure {
  state: string;
  message?: string;
  logUri?: string;
  log?: string;
  excerpt?: LogExcerpt;
  logError?: string;
}

export type RunOutcome =
  | { kind: 'completed'; execution: ScoreExecution & { outputTable: NonNullable<ScoreExecution['outputTable']> } }
  | { kind: 'failed'; failure: RunFailure }
  | { kind: 'stopped' };

const message = (err: unknown, fallback: string) =>
  (err as { message?: string })?.message ?? fallback;

/**
 * Run a score definition and wait for it. A run that ends without an output
 * table comes back as `failed` with the lines of its log that explain it: a
 * failed execution has no error message of its own (verified live), its log,
 * a Files resource at logFileUri, is what explains it.
 */
export async function runScoreDefinition(
  definitionId: string,
  executionName: string,
  shouldStop: () => boolean,
  onPhase: (phase: string) => void
): Promise<RunOutcome> {
  onPhase('Running the test');
  const execution = await createScoreExecution(definitionId, executionName);
  const finished = await waitForScoreExecution(execution.id, shouldStop);
  if (shouldStop()) return { kind: 'stopped' };
  if (finished.state === 'completed' && finished.outputTable) {
    return { kind: 'completed', execution: { ...finished, outputTable: finished.outputTable } };
  }
  const failure: RunFailure = { state: finished.state, message: finished.error?.message, logUri: finished.logFileUri };
  if (finished.logFileUri) {
    onPhase('Reading the run log');
    try {
      failure.log = await getFileText(finished.logFileUri);
      failure.excerpt = logExcerpt(failure.log);
    } catch (err) {
      failure.logError = message(err, 'unknown error');
    }
  }
  return { kind: 'failed', failure };
}

/** The sentence an error alert shows for a failed run. */
export function runFailureText(failure: RunFailure): string {
  return (
    `The test run ended as "${failure.state}"${failure.message ? `: ${failure.message}` : ''}.` +
    (failure.excerpt ? ' The run log below shows why.' : ' Open the test in SAS Intelligent Decisioning to see its log.')
  );
}

/**
 * Read a test's output table and compare each row with what it expected.
 * Without `outputVariables` (a saved test) the checked outputs are taken from
 * the table's `expected_*` columns.
 */
export async function readTestResults(
  table: { serverName: string; libraryName: string; tableName: string },
  outputVariables?: string[]
): Promise<TestRunResults> {
  const [cols, data] = await Promise.all([
    getTableColumns(table.serverName, table.libraryName, table.tableName),
    getAllTableRows(table.serverName, table.libraryName, table.tableName),
  ]);
  const names = cols.map((c) => c.name);
  return compareResults(names, data.rows, outputVariables ?? expectedVariables(names));
}
