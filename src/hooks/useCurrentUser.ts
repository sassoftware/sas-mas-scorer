// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { getCurrentUser } from '../api/identities';

/**
 * The signed-in user's ID (what SAS writes into createdBy / modifiedBy), or
 * null until it is known or when the lookup fails — a "Mine" filter then
 * simply isn't offered.
 */
export function useCurrentUserId(enabled = true): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getCurrentUser()
      .then(u => { if (live) setId(u.id || null); })
      .catch(() => { if (live) setId(null); });
    return () => { live = false; };
  }, [enabled]);
  return id;
}
