// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react';
import { getCasServers, getCaslibs, CasServer, CasLib } from '../api/cas';
import { getSasViyaUrl } from '../config';
import { registerViewCache } from '../utils/viewCaches';

/**
 * Shared CAS server / caslib catalogue.
 *
 * Six dialogs (SaveScenarioDialog, SaveBatchScenariosDialog, SaveTestDialog,
 * CasUploadDialog, CasTableScore, schemaBuilder/SaveToSidDialog) each ran the
 * same pair of effects, so every open refetched the same two collections.
 * This hook keeps one cache for the session, keyed by the active Viya URL,
 * and collapses each consumer's two effects into one call.
 *
 * Cache rules:
 *  - keyed by `getSasViyaUrl()`, so switching to a connection with a
 *    different URL never serves the previous environment's servers. The key
 *    is not enough on its own: two connections to the same host (different
 *    credentials or tenant) share it, and logging out and back in as another
 *    user does not change it at all, so the shell must also call
 *    `clearCasCatalog()` (via `clearAllViewCaches()`) on logout and on every
 *    connection switch;
 *  - only fulfilled results are stored; a rejection evicts the in-flight
 *    entry, so one transient 401 does not poison the rest of the session;
 *  - concurrent callers share one in-flight request per server.
 */

const EMPTY_SERVERS: CasServer[] = [];
const EMPTY_CASLIBS: CasLib[] = [];

interface CatalogEntry {
  servers: CasServer[] | null;
  serversInFlight: Promise<CasServer[]> | null;
  caslibs: Map<string, CasLib[]>;
  caslibsInFlight: Map<string, Promise<CasLib[]>>;
}

let cacheKey: string | null = null;
let cache: CatalogEntry | null = null;

const entryFor = (key: string): CatalogEntry => {
  if (!cache || cacheKey !== key) {
    cacheKey = key;
    cache = {
      servers: null,
      serversInFlight: null,
      caslibs: new Map(),
      caslibsInFlight: new Map(),
    };
  }
  return cache;
};

/** Cached servers for `key`, or null when nothing is cached for it yet. */
const peekServers = (key: string): CasServer[] | null =>
  cache && cacheKey === key ? cache.servers : null;

/** Cached caslibs of `serverName`, or null when nothing is cached for them. */
const peekCaslibs = (key: string, serverName: string): CasLib[] | null =>
  cache && cacheKey === key ? cache.caslibs.get(serverName) ?? null : null;

/**
 * Drop the whole catalogue. The shell calls this when the session changes
 * (logout, Electron connection switch); mounted hooks pick the empty cache up
 * on their next load, and `refresh()` clears then reloads in one step.
 */
export const clearCasCatalog = (): void => {
  cacheKey = null;
  cache = null;
};

registerViewCache('casCatalog', clearCasCatalog);

const fetchServers = (key: string): Promise<CasServer[]> => {
  const entry = entryFor(key);
  if (entry.servers) return Promise.resolve(entry.servers);
  if (entry.serversInFlight) return entry.serversInFlight;

  const request = getCasServers().then(
    (list) => {
      // Store only if this entry is still the live cache: the connection may
      // have switched (or the cache been cleared) while the request ran.
      if (cache === entry) {
        entry.servers = list;
        entry.serversInFlight = null;
      }
      return list;
    },
    (err: unknown) => {
      // Evict, never cache a failure, so the next consumer retries.
      entry.serversInFlight = null;
      throw err;
    }
  );
  entry.serversInFlight = request;
  return request;
};

const fetchCaslibs = (key: string, serverName: string): Promise<CasLib[]> => {
  const entry = entryFor(key);
  const cached = entry.caslibs.get(serverName);
  if (cached) return Promise.resolve(cached);
  const inFlight = entry.caslibsInFlight.get(serverName);
  if (inFlight) return inFlight;

  const request = getCaslibs(serverName).then(
    (list) => {
      if (cache === entry) {
        entry.caslibs.set(serverName, list);
        entry.caslibsInFlight.delete(serverName);
      }
      return list;
    },
    (err: unknown) => {
      entry.caslibsInFlight.delete(serverName);
      throw err;
    }
  );
  entry.caslibsInFlight.set(serverName, request);
  return request;
};

const messageOf = (err: unknown, fallback: string): string =>
  (err as { message?: string })?.message ?? fallback;

export interface UseCasCatalogReturn {
  /** Every CAS server of the active connection; [] until loaded. */
  servers: CasServer[];
  /** Caslibs of the `serverName` passed in; [] when none is selected yet. */
  caslibs: CasLib[];
  loadingServers: boolean;
  loadingCaslibs: boolean;
  /**
   * The current server failure, or the caslib one when the servers loaded.
   * Each load clears its own message when it next succeeds or is skipped, so
   * a failure never outlives the state that produced it.
   */
  error: string | null;
  /** Drop the cache and reload the servers and the current server's caslibs. */
  refresh: () => void;
}

/**
 * @param serverName the selected CAS server; pass null/undefined while the
 * user has not chosen one, and the caslib load is skipped.
 */
export const useCasCatalog = (serverName?: string | null): UseCasCatalogReturn => {
  const key = getSasViyaUrl();

  const [servers, setServers] = useState<CasServer[]>(
    () => peekServers(key) ?? EMPTY_SERVERS
  );
  const [loadingServers, setLoadingServers] = useState(() => peekServers(key) === null);
  const [caslibs, setCaslibs] = useState<CasLib[]>(
    () => (serverName ? peekCaslibs(key, serverName) : null) ?? EMPTY_CASLIBS
  );
  const [loadingCaslibs, setLoadingCaslibs] = useState(
    () => !!serverName && peekCaslibs(key, serverName) === null
  );
  // Kept apart so each load only ever clears its own failure; the two are
  // merged into the single `error` of the public contract.
  const [serversError, setServersError] = useState<string | null>(null);
  const [caslibsError, setCaslibsError] = useState<string | null>(null);
  // Bumped by refresh() to re-run both loads against the emptied cache.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Every path through this effect settles the error, so a failure never
    // outlives the load that produced it (including the cached-hit path).
    const cached = peekServers(key);
    if (cached) {
      setServers(cached);
      setServersError(null);
      setLoadingServers(false);
      return;
    }

    let cancelled = false;
    // Drop the previous connection's servers rather than showing them while
    // the new environment loads (the caslib effect does the same below).
    setServers(EMPTY_SERVERS);
    setServersError(null);
    setLoadingServers(true);
    fetchServers(key)
      .then((list) => {
        if (cancelled) return;
        setServers(list);
        setServersError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setServersError(messageOf(err, 'Failed to load CAS servers'));
      })
      .finally(() => {
        if (!cancelled) setLoadingServers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  useEffect(() => {
    if (!serverName) {
      setCaslibs(EMPTY_CASLIBS);
      setCaslibsError(null);
      setLoadingCaslibs(false);
      return;
    }

    const cached = peekCaslibs(key, serverName);
    if (cached) {
      setCaslibs(cached);
      setCaslibsError(null);
      setLoadingCaslibs(false);
      return;
    }

    let cancelled = false;
    setCaslibs(EMPTY_CASLIBS);
    setCaslibsError(null);
    setLoadingCaslibs(true);
    fetchCaslibs(key, serverName)
      .then((list) => {
        if (cancelled) return;
        setCaslibs(list);
        setCaslibsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCaslibsError(messageOf(err, 'Failed to load caslibs'));
      })
      .finally(() => {
        if (!cancelled) setLoadingCaslibs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, serverName, reloadToken]);

  // Note: the cache is module-wide but the reload token is per instance, so
  // refresh() reloads the caller and leaves any other mounted consumer
  // rendering its last arrays until its own deps change. Only one CAS dialog
  // is open at a time today; a view with two would need a shared token.
  const refresh = useCallback(() => {
    clearCasCatalog();
    setServersError(null);
    setCaslibsError(null);
    setReloadToken((token) => token + 1);
  }, []);

  return {
    servers,
    caslibs,
    loadingServers,
    loadingCaslibs,
    error: serversError ?? caslibsError,
    refresh,
  };
};
