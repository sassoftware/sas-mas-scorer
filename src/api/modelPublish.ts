// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import {
  PublishDestination,
  PublishDestinationCollection,
  PublishedItem,
  PublishedItemCollection,
} from '../types/modelPublish';

/**
 * modelPublish honours a page size well above the usual 100, and each request
 * costs a couple of seconds, so a larger page is worth far more than a smaller
 * one: 424 items came back in one 2s request instead of five totalling ~16s.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 200; // safety cap

/** Reported after every page so callers can show that the load is advancing. */
export interface PageProgress {
  /** Items accumulated so far. */
  loaded: number;
  /** Page requests completed. */
  page: number;
  /** Total the service reported, or null — modelPublish does not send `count`. */
  total: number | null;
}

async function fetchAllPaginated<T>(
  url: string,
  params: Record<string, string | number | undefined> = {},
  onPage?: (progress: PageProgress) => void
): Promise<T[]> {
  const items: T[] = [];
  let start = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await sasViyaClient.get<{
      items: T[];
      count?: number;
      start?: number;
      limit?: number;
    }>(url, {
      params: { ...params, start, limit: PAGE_SIZE },
      headers: { Accept: 'application/vnd.sas.collection+json' },
    });

    const pageItems = response.data.items ?? [];
    items.push(...pageItems);

    const total = typeof response.data.count === 'number' ? response.data.count : null;
    onPage?.({ loaded: items.length, page: page + 1, total });

    if (pageItems.length === 0) break;
    if (total !== null && items.length >= total) break;

    // A service may cap the page size below what we asked for, so compare
    // against the limit it echoed back — comparing against PAGE_SIZE would
    // treat a capped full page as the last one and silently truncate.
    const effectiveLimit =
      typeof response.data.limit === 'number' && response.data.limit > 0
        ? response.data.limit
        : PAGE_SIZE;
    if (pageItems.length < effectiveLimit) break;

    start += pageItems.length;
  }

  return items;
}

export const getAllDestinations = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishDestination[]> => {
  return fetchAllPaginated<PublishDestination>('/modelPublish/destinations', {}, onPage);
};

export const getAllCompletedPublishedItems = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishedItem[]> => {
  return fetchAllPaginated<PublishedItem>(
    '/modelPublish/models',
    {
      filter: "eq(state,'completed')",
      sortBy: 'creationTimeStamp:descending',
    },
    onPage
  );
};

// Re-exported for testing convenience
export type { PublishDestinationCollection, PublishedItemCollection };
