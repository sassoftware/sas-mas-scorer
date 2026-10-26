// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// The one page walker for SAS Viya collection endpoints.
//
// Every collection call in src/api goes through here so the termination rules
// exist once. A Viya collection defaults to 10 items when no limit is sent,
// and a service may cap the page size below what was asked for — the response
// echoes the limit it actually applied (and usually a `count`). Walking pages
// against the *requested* size treats a capped full page as the last one and
// silently truncates; this walker compares against the echoed limit instead.
//
// Once a page has reported a trusted `count`, the offsets of the pages still
// to come are known, so a few of them are requested at once (`concurrency`).
// They are still handled strictly in order — accumulation, `onPage` and every
// stop rule work exactly as in a one-page-at-a-time walk; the next pages are
// simply already on their way. Read-ahead that turns out not to be needed
// (a short page, a cancelled walk, an offset that no longer lines up) is
// aborted and ignored.

import type { AxiosInstance } from 'axios';
import { sasViyaClient } from './client';

export const DEFAULT_PAGE_SIZE = 100;
/** Safety cap so a service that ignores `start` cannot loop forever. */
export const DEFAULT_MAX_PAGES = 200;
/**
 * Page requests kept in flight once the total is known. Server time grows
 * with page size (a 1,000-item scoreDefinitions page took about 4.3 s, a
 * 100-item page about 0.5 s), so several modest pages at once beat one big one.
 */
export const DEFAULT_CONCURRENCY = 4;

const COLLECTION_ACCEPT = 'application/vnd.sas.collection+json';

/** Reported after every page so callers can show that a load is advancing. */
export interface PageProgress {
  /** Items received so far across all pages. */
  loaded: number;
  /** Page requests completed (1-based). */
  page: number;
  /** Total the service reported, or null when it sends no usable `count`. */
  total: number | null;
  /**
   * Pages the walk expects to read in all (at most `maxPages`), worked out
   * from the trusted `count` and the page size the service applied; null when
   * there is no trusted count to work it out from.
   */
  pageCount?: number | null;
}

/** One page as handed to `onPage`. */
export interface CollectionPage<T> extends PageProgress {
  /** The items of this page only. */
  items: T[];
  /** 0-based index of this page. */
  pageIndex: number;
  /**
   * True when this page came back full (measured against the limit the
   * service echoed) and `count`, if trusted, is not yet reached — i.e. the
   * walker would request another page.
   */
  hasMore: boolean;
}

export interface PaginatedCollection<T> {
  /** All items received (empty when `accumulate` is false). */
  items: T[];
  /** Total the service reported, or null. */
  total: number | null;
  /** Items received; equals `items.length` unless `accumulate` is false. */
  loaded: number;
  /** True when the walk hit `maxPages` while another page still existed. */
  truncated: boolean;
  /** True when `onPage` returned `false` and the walk stopped early. */
  cancelled: boolean;
}

export interface PaginateOptions<T> {
  /** Axios instance to use; defaults to the generic Viya client. */
  client?: AxiosInstance;
  /** Extra query parameters (filter, sortBy, …); `start`/`limit` are set by the walker. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Extra headers; `Accept` defaults to the collection media type. */
  headers?: Record<string, string>;
  /** Items requested per page. The service may apply a smaller one. */
  pageSize?: number;
  /** Maximum page requests before giving up (see `truncated`). */
  maxPages?: number;
  /** Offset of the first item. */
  start?: number;
  /** Per-request timeout override in ms. */
  timeout?: number;
  /**
   * Stop once `count` items have been received (default true). Set false for
   * services whose `count` is known to be unreliable; the walk then ends only
   * on a short or empty page or at `maxPages`.
   */
  trustCount?: boolean;
  /**
   * Page requests kept in flight once a trusted `count` is known (default
   * DEFAULT_CONCURRENCY; 1 reads one page at a time). Without a trusted count
   * — `trustCount` false, or a service that sends none — the end of the
   * collection shows only as a short page, so such a walk stays sequential.
   */
  concurrency?: number;
  /** Keep the items (default true). Set false for streaming walks via `onPage`. */
  accumulate?: boolean;
  /** Called after every page, in page order; return `false` to stop the walk. */
  onPage?: (page: CollectionPage<T>) => boolean | void | Promise<boolean | void>;
  /**
   * Cancels the walk: the page in flight and any read-ahead are aborted and
   * the call rejects with axios' CanceledError.
   */
  signal?: AbortSignal;
}

interface CollectionEnvelope<T> {
  items?: T[];
  count?: number;
  start?: number;
  limit?: number;
}

/** A page requested ahead of the walk. */
interface ReadAhead<T> {
  data: Promise<CollectionEnvelope<T>>;
  controller: AbortController;
}

/**
 * Walk a collection page by page. Stops when a page is empty, when a page is
 * shorter than the limit the service echoed back, when the trusted `count` is
 * reached, when `onPage` returns false, or at `maxPages`. Advances `start` by
 * the number of items actually received, never by the requested page size.
 */
export async function paginateCollection<T>(
  url: string,
  options: PaginateOptions<T> = {}
): Promise<PaginatedCollection<T>> {
  const {
    client = sasViyaClient,
    params = {},
    headers = {},
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    timeout,
    trustCount = true,
    accumulate = true,
    onPage,
  } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));

  const firstStart = options.start ?? 0;
  const items: T[] = [];
  let start = firstStart;
  let loaded = 0;
  let total: number | null = null;
  let truncated = false;
  let cancelled = false;

  // A read-ahead page answers to both its own controller (dropped plans) and
  // the caller's signal (the whole walk stopped).
  const callerSignal = options.signal;
  const withCallerSignal = (signal?: AbortSignal): AbortSignal | undefined => {
    if (!callerSignal) return signal;
    if (!signal) return callerSignal;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, callerSignal]) : signal;
  };

  const requestPage = (pageStart: number, signal?: AbortSignal) => {
    const effectiveSignal = withCallerSignal(signal);
    return client
      .get<CollectionEnvelope<T>>(url, {
        params: { ...params, start: pageStart, limit: pageSize },
        headers: { Accept: COLLECTION_ACCEPT, ...headers },
        ...(timeout !== undefined ? { timeout } : {}),
        ...(effectiveSignal ? { signal: effectiveSignal } : {}),
      })
      .then((response) => response.data);
  };

  // Pages requested ahead of the walk, keyed by their offset. `aheadStep` is
  // the page size they were planned with, `aheadNext` the next offset to plan.
  const ahead = new Map<number, ReadAhead<T>>();
  let aheadStep = 0;
  let aheadNext = 0;
  const dropReadAhead = () => {
    ahead.forEach((page) => page.controller.abort());
    ahead.clear();
  };

  try {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const readAhead = ahead.get(start);
      if (readAhead) ahead.delete(start);
      const data = await (readAhead ? readAhead.data : requestPage(start));

      const pageItems = data.items ?? [];
      if (accumulate) items.push(...pageItems);
      loaded += pageItems.length;

      // Gateways sometimes send -1 or 0 for an unknown total, so only a
      // positive count is allowed to end the walk.
      const count = data.count;
      if (typeof count === 'number' && count >= 0) total = count;
      const countTrusted = trustCount && total !== null && total > 0;
      const countReached = countTrusted && loaded >= (total as number);

      // A service may cap the page size below what we asked for, so compare
      // against the limit it echoed back — comparing against pageSize would
      // treat a capped full page as the last one and silently truncate.
      const effectiveLimit =
        typeof data.limit === 'number' && data.limit > 0 ? data.limit : pageSize;
      const hasMore =
        pageItems.length > 0 && pageItems.length >= effectiveLimit && !countReached;

      const pageCount = countTrusted
        ? Math.max(
            pageIndex + 1,
            Math.min(maxPages, Math.ceil(((total as number) - firstStart) / effectiveLimit))
          )
        : null;

      const cont = await onPage?.({
        items: pageItems,
        pageIndex,
        page: pageIndex + 1,
        loaded,
        total,
        pageCount,
        hasMore,
      });
      if (cont === false) {
        cancelled = true;
        break;
      }
      if (!hasMore) break;
      if (pageIndex === maxPages - 1) {
        truncated = true;
        break;
      }

      start += pageItems.length;

      // Read ahead once the total is trusted. A page that came back with a
      // different size than planned (or a changed echoed limit) moves every
      // later offset, so the planned pages are dropped and planned afresh.
      if (concurrency > 1 && countTrusted) {
        if (ahead.size > 0 && (aheadStep !== effectiveLimit || !ahead.has(start))) {
          dropReadAhead();
        }
        if (ahead.size === 0) {
          aheadStep = effectiveLimit;
          aheadNext = start;
        }
        // Never request more pages in all than maxPages allows.
        let budget = Math.min(concurrency - ahead.size, maxPages - (pageIndex + 1) - ahead.size);
        while (budget > 0 && aheadNext < (total as number)) {
          const controller = new AbortController();
          const page = requestPage(aheadNext, controller.signal);
          // Its failure is reported when the walk reaches it; a page dropped
          // before then must not surface as an unhandled rejection.
          page.catch(() => undefined);
          ahead.set(aheadNext, { data: page, controller });
          aheadNext += aheadStep;
          budget--;
        }
      }
    }
  } finally {
    dropReadAhead();
  }

  return { items, total, loaded, truncated, cancelled };
}

/** `paginateCollection` for callers that only want the items. */
export async function fetchAllPaginated<T>(
  url: string,
  options: PaginateOptions<T> = {}
): Promise<T[]> {
  const result = await paginateCollection<T>(url, options);
  return result.items;
}
