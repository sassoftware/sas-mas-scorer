// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Registry of the module-scoped caches that must be dropped when the session
 * changes (log out / log in, switching Electron connection).
 *
 * Views and hooks that keep a cache register their own clear function here;
 * the shell then calls `clearAllViewCaches()` without importing any view.
 * That keeps the header out of the lazily loaded view chunks: importing
 * `clearCoverageAnalysisCache` from the coverage view pulled the whole
 * coverage module into the entry bundle.
 *
 * This module must stay dependency-free (no React, no API, no view imports).
 */

type ClearFn = () => void;

const registry = new Map<string, ClearFn>();

/**
 * Register (or replace) the cache-clear function published under `name`.
 * Call it at module scope next to the cache it clears, e.g.
 *
 *   registerViewCache('coverage', clearCoverageAnalysisCache);
 *
 * `name` is a stable identifier for one cache; registering the same name
 * twice replaces the previous function (module re-evaluation under HMR).
 * Returns an unregister function for callers that need one.
 */
export const registerViewCache = (name: string, clearFn: ClearFn): (() => void) => {
  registry.set(name, clearFn);
  return () => {
    if (registry.get(name) === clearFn) registry.delete(name);
  };
};

/**
 * Clear every registered cache. Only the caches whose owning module has been
 * loaded are registered, which is exactly the set that can hold stale data.
 * A failing clear function never stops the others.
 */
export const clearAllViewCaches = (): void => {
  registry.forEach((clearFn, name) => {
    try {
      clearFn();
    } catch (err) {
      console.error(`Failed to clear the "${name}" cache:`, err);
    }
  });
};

/** Names currently registered; for diagnostics and tests. */
export const getRegisteredViewCaches = (): string[] => Array.from(registry.keys());
