// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import {
  PublishDestination,
  PublishDestinationCollection,
  PublishedItem,
  PublishedItemCollection,
} from '../types/modelPublish';

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // safety cap (20,000 items)

async function fetchAllPaginated<T>(
  url: string,
  params: Record<string, string | number | undefined> = {}
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

    if (pageItems.length < PAGE_SIZE) break;
    if (typeof response.data.count === 'number' && items.length >= response.data.count) break;

    start += PAGE_SIZE;
  }

  return items;
}

export const getAllDestinations = async (): Promise<PublishDestination[]> => {
  return fetchAllPaginated<PublishDestination>('/modelPublish/destinations');
};

export const getAllCompletedPublishedItems = async (): Promise<PublishedItem[]> => {
  return fetchAllPaginated<PublishedItem>('/modelPublish/models', {
    filter: "eq(state,'completed')",
    sortBy: 'creationTimeStamp:descending',
  });
};

// Re-exported for testing convenience
export type { PublishDestinationCollection, PublishedItemCollection };
