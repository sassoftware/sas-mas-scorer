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

import type { AxiosInstance } from 'axios';
import { sasViyaClient } from './client';

export const DEFAULT_PAGE_SIZE = 100;
/** Safety cap so a service that ignores `start` cannot loop forever. */
export const DEFAULT_MAX_PAGES = 200;

const COLLECTION_ACCEPT = 'application/vnd.sas.collection+json';

/** Reported after every page so callers can show that a load is advancing. */
export interface PageProgress {
  /** Items received so far across all pages. */
  loaded: number;
  /** Page requests completed (1-based). */
  page: number;
  /** Total the service reported, or null when it sends no usable `count`. */
  total: number | null;
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
  /** Keep the items (default true). Set false for streaming walks via `onPage`. */
  accumulate?: boolean;
  /** Called after every page; return `false` to stop the walk. */
  onPage?: (page: CollectionPage<T>) => boolean | void | Promise<boolean | void>;
}

interface CollectionEnvelope<T> {
  items?: T[];
  count?: number;
  start?: number;
  limit?: number;
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

  const items: T[] = [];
  let start = options.start ?? 0;
  let loaded = 0;
  let total: number | null = null;
  let truncated = false;
  let cancelled = false;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const response = await client.get<CollectionEnvelope<T>>(url, {
      params: { ...params, start, limit: pageSize },
      headers: { Accept: COLLECTION_ACCEPT, ...headers },
      ...(timeout !== undefined ? { timeout } : {}),
    });

    const pageItems = response.data.items ?? [];
    if (accumulate) items.push(...pageItems);
    loaded += pageItems.length;

    // Gateways sometimes send -1 or 0 for an unknown total, so only a
    // positive count is allowed to end the walk.
    const count = response.data.count;
    if (typeof count === 'number' && count >= 0) total = count;
    const countReached = trustCount && total !== null && total > 0 && loaded >= total;

    // A service may cap the page size below what we asked for, so compare
    // against the limit it echoed back — comparing against pageSize would
    // treat a capped full page as the last one and silently truncate.
    const effectiveLimit =
      typeof response.data.limit === 'number' && response.data.limit > 0
        ? response.data.limit
        : pageSize;
    const hasMore =
      pageItems.length > 0 && pageItems.length >= effectiveLimit && !countReached;

    const cont = await onPage?.({
      items: pageItems,
      pageIndex,
      page: pageIndex + 1,
      loaded,
      total,
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
