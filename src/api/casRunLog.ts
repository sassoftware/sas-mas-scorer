// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { SAS_NAME, withCasSession } from './casSession';

/** Where an app writes its run log: a CAS library and table. */
export interface RunLogTarget {
  caslib: string;
  table: string;
  /** CAS server; the first one when unset. */
  server?: string;
}

/** One logged run. Fixed columns, so the table keeps working when the app or module changes. */
export interface RunLogRow {
  app_name: string;
  app_id: string;
  module: string;
  step: string;
  ran_at: string;
  user_id: string;
  status: 'completed' | 'failed';
  message: string;
  latency_ms: number;
  /** The inputs sent and the results returned, as JSON text. */
  inputs: string;
  outputs: string;
}

export { SAS_NAME };

// A DATA step string literal holds at most 32,767 characters.
const MAX_LITERAL = 32000;

/** A SAS string literal: single quotes doubled, line breaks as spaces, cut to fit. */
function sasLiteral(value: string): string {
  let text = value.replace(/[\r\n]+/g, ' ');
  if (text.length > MAX_LITERAL) text = `${text.slice(0, MAX_LITERAL - 20)}…(truncated)`;
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Append one row to the log table through a short CAS session (casProxy):
 * the row is built in the session by a single-threaded DATA step, then
 * appended to the table, or the table is created and made global (promoted)
 * on the first run. The session is ended afterwards. Rejects with CAS's
 * message when something fails; the caller decides what to show.
 */
export async function appendRunLog(target: RunLogTarget, row: RunLogRow): Promise<void> {
  if (!SAS_NAME.test(target.caslib) || !SAS_NAME.test(target.table)) {
    throw new Error(`${target.caslib}.${target.table} is not a CAS library and table name the log can use.`);
  }
  await withCasSession(async (action) => {
    const assign = (Object.entries(row) as [string, string | number][])
      .map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '.') : sasLiteral(v)};`)
      .join(' ');
    const lengths = Object.entries(row).filter(([, v]) => typeof v !== 'number').map(([k]) => `${k} varchar(*)`).join(' ');
    await action('datastep.runCode', {
      code: `data casuser._mss_log_row; length ${lengths}; ${assign} output; run;`,
      single: 'YES',
    });
    const exists = (await action('table.tableExists', { caslib: target.caslib, name: target.table }))?.results?.exists;
    const into = `${target.caslib}.${target.table}`;
    await action('datastep.runCode', {
      code: exists
        ? `data ${into}(append=yes); set casuser._mss_log_row; run;`
        : `data ${into}(promote=yes); set casuser._mss_log_row; run;`,
    });
  }, target.server);
}
