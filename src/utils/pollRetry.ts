// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Back-off schedule for a polling section after failed requests: 5 s, 10 s,
 * 30 s, then every 60 s until a request succeeds again. A dropped request (a
 * token refresh, a brief gateway hiccup) recovers on the first retry; a
 * longer outage is probed once a minute instead of being hammered every tick.
 *
 * This module must stay dependency-free (no React, no API).
 */
export const POLL_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 30_000, 60_000];

/**
 * Delay before retry number `failures` (1 = after the first failure), with
 * ±20 % jitter so several sections — or several open tabs — that failed
 * together do not retry in lockstep.
 */
export const pollRetryDelayMs = (failures: number, random: () => number = Math.random): number => {
  const index = Math.min(Math.max(failures, 1), POLL_RETRY_DELAYS_MS.length) - 1;
  const base = POLL_RETRY_DELAYS_MS[index];
  return Math.round(base * (0.8 + random() * 0.4));
};
