// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Session cache for the heavy reads that are visited again and again:
 * decision flows and their revisions, segmentation trees (about 1 MB each),
 * rule sets, treatment and REST API definitions, MAS module metadata.
 *
 * It sits inside the API functions, so every page that calls them benefits:
 *
 * - In-flight de-duplication: two callers asking for the same key at the same
 *   time share one request.
 * - Fresh window (`freshMs`): a stored answer is returned with no request.
 * - Stale-while-revalidate (`staleMs`): after the fresh window, the stored
 *   answer is still returned at once while a background request refreshes
 *   it. When the refreshed answer differs, `subscribeRequestCache` listeners
 *   hear about it, so a page can show the new version.
 * - `{ refresh: true }` skips the stored answer (Refresh / Retry buttons).
 * - Failures are never stored; a failed background refresh drops the entry,
 *   so the next visit asks the server and shows the real error.
 * - A changed answer that is identical in content keeps the old object, so
 *   identity-keyed memos (WeakMaps, React deps) stay valid.
 *
 * Everything is dropped on log out / log in and on an Electron connection
 * switch through the view-cache registry, and mutations call
 * `invalidateRequestCache` for what they change. Requests that were already
 * running when the cache was cleared or invalidated still answer their own
 * callers but are not stored.
 */

import { registerViewCache } from '../utils/viewCaches';

export interface CachePolicy<T> {
  /**
   * How long a stored answer is used without asking the server, in ms. A
   * function decides per answer, e.g. Infinity for a locked revision.
   */
  freshMs: number | ((value: T) => number);
  /**
   * For how much longer after `freshMs` the stored answer is still returned at
   * once while it is refreshed in the background. 0 (the default) waits for
   * the server instead.
   */
  staleMs?: number;
  /**
   * Most answers kept for this kind of key (the part of the key before the
   * first ':'); the least recently used goes first. Defaults to
   * DEFAULT_MAX_ENTRIES. Keep it small for large documents.
   */
  maxEntries?: number;
  /** Return false for an answer that must not be stored (e.g. a partial one). */
  keep?: (value: T) => boolean;
}

export interface RequestOptions {
  /** Ask the server even when a stored answer exists; the answer replaces it. */
  refresh?: boolean;
}

/** Called when a stored answer is replaced by a different one. */
export type RequestCacheListener = (key: string, value: unknown) => void;

export const DEFAULT_MAX_ENTRIES = 200;
/** One minute, the freshness the list pages use too. */
export const CACHE_FRESH_MS = 60_000;
/** How long after that a stored SID document may be shown while it is refreshed. */
export const CACHE_STALE_MS = 15 * 60_000;

interface Entry {
  value: unknown;
  storedAt: number;
  freshMs: number;
  staleMs: number;
}

// Map iteration order is insertion order; a hit re-inserts its entry, so the
// first entry of a kind is always its least recently used.
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Set<RequestCacheListener>();
// Bumped by every clear and invalidation. A request started under an older
// generation answers its callers but is not stored.
let generation = 0;

const kindOf = (key: string): string => {
  const colon = key.indexOf(':');
  return colon < 0 ? key : key.slice(0, colon);
};

function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function evict(kind: string, maxEntries: number): void {
  let count = 0;
  entries.forEach((_entry, key) => {
    if (kindOf(key) === kind) count++;
  });
  if (count <= maxEntries) return;
  for (const key of entries.keys()) {
    if (count <= maxEntries) break;
    if (kindOf(key) === kind) {
      entries.delete(key);
      count--;
    }
  }
}

/** Store an answer; returns the object callers should get (the old one when unchanged). */
function store<T>(key: string, value: T, policy: CachePolicy<T>): T {
  const freshMs = typeof policy.freshMs === 'function' ? policy.freshMs(value) : policy.freshMs;
  const staleMs = policy.staleMs ?? 0;
  if (!(freshMs > 0) && !(staleMs > 0)) return value;
  if (policy.keep && !policy.keep(value)) return value;

  const previous = entries.get(key);
  const unchanged = previous !== undefined && sameContent(previous.value, value);
  const kept = unchanged ? (previous.value as T) : value;
  entries.delete(key);
  entries.set(key, { value: kept, storedAt: Date.now(), freshMs, staleMs });
  evict(kindOf(key), policy.maxEntries ?? DEFAULT_MAX_ENTRIES);

  if (previous !== undefined && !unchanged) {
    listeners.forEach((listener) => {
      try {
        listener(key, kept);
      } catch (err) {
        console.error('A request cache listener failed:', err);
      }
    });
  }
  return kept;
}

function load<T>(key: string, fetcher: () => Promise<T>, policy: CachePolicy<T>): Promise<T> {
  const startedIn = generation;
  const settle = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  const promise: Promise<T> = fetcher().then(
    (value) => {
      settle();
      return generation === startedIn ? store(key, value, policy) : value;
    },
    (err: unknown) => {
      settle();
      throw err;
    }
  );
  inFlight.set(key, promise);
  return promise;
}

/**
 * The cached answer for `key`, fetching it with `fetcher` when there is no
 * usable one. See the module comment for the rules.
 */
export function cachedRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  policy: CachePolicy<T>,
  options: RequestOptions = {}
): Promise<T> {
  if (!options.refresh) {
    const entry = entries.get(key);
    if (entry) {
      const age = Date.now() - entry.storedAt;
      if (age < entry.freshMs + entry.staleMs) {
        entries.delete(key);
        entries.set(key, entry);
        if (age >= entry.freshMs && !inFlight.has(key)) {
          load(key, fetcher, policy).catch(() => {
            // The stored answer may be gone (deleted, access revoked): drop it,
            // so the next visit asks the server and shows the error.
            if (entries.get(key) === entry) entries.delete(key);
          });
        }
        return Promise.resolve(entry.value as T);
      }
      entries.delete(key);
    }
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }
  return load(key, fetcher, policy);
}

/** The stored answer for `key`, whatever its age, without any request. */
export function peekRequestCache<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

/**
 * Forget stored answers and running requests: every key starting with
 * `match` when it is a string, or every key it accepts when a function.
 */
export function invalidateRequestCache(match: string | ((key: string) => boolean)): void {
  const hit = typeof match === 'string' ? (key: string) => key.startsWith(match) : match;
  generation++;
  for (const key of [...entries.keys()]) {
    if (hit(key)) entries.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (hit(key)) inFlight.delete(key);
  }
}

/** Forget everything (log out, log in, connection switch). */
export function clearRequestCache(): void {
  generation++;
  entries.clear();
  inFlight.clear();
}

/**
 * Hear about stored answers that were replaced by a different one, e.g. a
 * flow re-saved in SAS Intelligent Decisioning found by a background
 * refresh. Returns the unsubscribe function.
 */
export function subscribeRequestCache(listener: RequestCacheListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Policy for a SAS Intelligent Decisioning document read by URI. A locked
 * revision (`…/revisions/{id}` with `locked: true`) never changes again and is
 * kept for the session. Anything else — a current document such as
 * `/decisions/flows/{id}`, which a new version re-points even when its
 * revision is locked, or an unlocked revision still being edited — is fresh
 * for CACHE_FRESH_MS and then refreshed in the background for CACHE_STALE_MS.
 */
export function sidDocumentPolicy<T>(uri: string, maxEntries?: number): CachePolicy<T> {
  const isRevision = /\/revisions\/[^/]+\/?$/.test(uri.split('?')[0]);
  return {
    freshMs: isRevision
      ? (value: T) =>
          (value as { locked?: unknown } | null)?.locked === true ? Infinity : CACHE_FRESH_MS
      : CACHE_FRESH_MS,
    staleMs: CACHE_STALE_MS,
    ...(maxEntries !== undefined ? { maxEntries } : {}),
  };
}

/** Policy that only joins identical requests running at the same time; nothing is kept. */
export const IN_FLIGHT_ONLY: { readonly freshMs: number } = { freshMs: 0 };

registerViewCache('requestCache', clearRequestCache);
