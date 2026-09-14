// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fetchAllPaginated, PageProgress } from './paginate';
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
 * (modelPublish does not send `count`, so `total` in the progress is null.)
 */
const PAGE_SIZE = 500;

export type { PageProgress };

export const getAllDestinations = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishDestination[]> => {
  return fetchAllPaginated<PublishDestination>('/modelPublish/destinations', {
    pageSize: PAGE_SIZE,
    onPage,
  });
};

export const getAllCompletedPublishedItems = async (
  onPage?: (progress: PageProgress) => void
): Promise<PublishedItem[]> => {
  return fetchAllPaginated<PublishedItem>('/modelPublish/models', {
    params: {
      filter: "eq(state,'completed')",
      sortBy: 'creationTimeStamp:descending',
    },
    pageSize: PAGE_SIZE,
    onPage,
  });
};

// Re-exported for testing convenience
export type { PublishDestinationCollection, PublishedItemCollection };
