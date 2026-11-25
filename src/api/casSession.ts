// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { getCasServers } from './cas';

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } };

/** CAS library, table and column names the app puts into CAS code (plain SAS names). */
export const SAS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CasAction = (name: string, params: Record<string, unknown>) => Promise<any>;

/**
 * Run CAS actions in a short session through casProxy, ended afterwards. An
 * action whose disposition is an error rejects with CAS's own message.
 */
export async function withCasSession<T>(work: (action: CasAction) => Promise<T>, server?: string): Promise<T> {
  const name = server || await defaultServer();
  const base = `/casProxy/servers/${encodeURIComponent(name)}/cas`;
  const session: string = (await sasViyaClient.post(`${base}/sessions`, {}, JSON_HEADERS)).data.session;
  const action: CasAction = async (actionName, params) => {
    const r = await sasViyaClient.post(`${base}/sessions/${session}/actions/${actionName}`, params, JSON_HEADERS);
    if (r.data?.disposition?.severity === 'Error') {
      const errorLine = String(r.data?.log ?? '').split('\n').find((l: string) => l.startsWith('ERROR:'));
      throw new Error(errorLine?.replace(/^ERROR:\s*/, '') || r.data?.disposition?.formattedStatus || `${actionName} failed`);
    }
    return r.data;
  };
  try {
    return await work(action);
  } finally {
    sasViyaClient.delete(`${base}/sessions/${session}`).catch(() => undefined);
  }
}
