// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { getCasServers } from './cas';

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

/** CAS library and table names a DATA step can use (plain SAS names). */
export const SAS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } };
// A DATA step string literal holds at most 32,767 characters.
const MAX_LITERAL = 32000;

/** A SAS string literal: single quotes doubled, line breaks as spaces, cut to fit. */
function sasLiteral(value: string): string {
  let text = value.replace(/[\r\n]+/g, ' ');
  if (text.length > MAX_LITERAL) text = `${text.slice(0, MAX_LITERAL - 20)}…(truncated)`;
  return `'${text.replace(/'/g, "''")}'`;
}

let firstServer: Promise<string> | null = null;
const defaultServer = () => {
  if (!firstServer) {
    firstServer = getCasServers().then(s => {
      if (!s[0]) throw new Error('No CAS server is available.');
      return s[0].name;
    });
    firstServer.catch(() => { firstServer = null; });
  }
  return firstServer;
};

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
  const server = target.server || await defaultServer();
  const base = `/casProxy/servers/${encodeURIComponent(server)}/cas`;
  const session: string = (await sasViyaClient.post(`${base}/sessions`, {}, JSON_HEADERS)).data.session;
  const action = async (name: string, params: Record<string, unknown>) => {
    const r = await sasViyaClient.post(`${base}/sessions/${session}/actions/${name}`, params, JSON_HEADERS);
    const severity = r.data?.disposition?.severity;
    if (severity === 'Error') {
      throw new Error(r.data?.disposition?.formattedStatus || (r.data?.log ?? '').trim().split('\n').pop() || `${name} failed`);
    }
    return r.data;
  };
  try {
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
  } finally {
    sasViyaClient.delete(`${base}/sessions/${session}`).catch(() => undefined);
  }
}
