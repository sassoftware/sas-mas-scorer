// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient, getSasViyaUrl } from './client';

export interface CurrentUser {
  /** The user ID SAS writes into createdBy / modifiedBy. */
  id: string;
  name?: string;
}

// One lookup per server; a failed lookup is not kept, so the next call retries.
const byServer = new Map<string, Promise<CurrentUser>>();

/** Who is signed in to the current SAS Viya server. */
export function getCurrentUser(): Promise<CurrentUser> {
  const server = getSasViyaUrl();
  let pending = byServer.get(server);
  if (!pending) {
    pending = sasViyaClient
      .get<CurrentUser>('/identities/users/@currentUser', {
        headers: { Accept: 'application/json' },
      })
      .then(r => ({ id: r.data.id, name: r.data.name }));
    pending.catch(() => byServer.delete(server));
    byServer.set(server, pending);
  }
  return pending;
}
