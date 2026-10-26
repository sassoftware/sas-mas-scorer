// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';

/** How often a polite live region may speak during a long run. */
export const ANNOUNCE_INTERVAL_MS = 10_000;

/**
 * The text for a polite live region, changed at most once per `intervalMs`.
 * A progress line that updates ten times a second would otherwise be read
 * out continuously (or not at all); this one speaks the latest value on the
 * leading edge and then at most once per interval. `flush` forces the current
 * text out immediately (a finished or paused run).
 */
export const useThrottledAnnouncement = (
  text: string,
  intervalMs: number = ANNOUNCE_INTERVAL_MS,
  flush = false
): string => {
  const [announced, setAnnounced] = useState(text);
  const lastAtRef = useRef(0);

  useEffect(() => {
    const wait = flush ? 0 : lastAtRef.current + intervalMs - Date.now();
    if (wait <= 0) {
      lastAtRef.current = Date.now();
      setAnnounced(text);
      return;
    }
    const timer = setTimeout(() => {
      lastAtRef.current = Date.now();
      setAnnounced(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, intervalMs, flush]);

  return announced;
};
