// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAllDestinations,
  getAllCompletedPublishedItems,
} from '../api/modelPublish';
import { PublishDestination, PublishedItem } from '../types/modelPublish';
import { dedupPublishedItems, getPublishedKind } from '../utils/publishHelpers';

export interface PublishingStats {
  destinationCount: number;
  modelCount: number;
  decisionCount: number;
}

interface UsePublishingOverviewReturn {
  destinations: PublishDestination[];
  dedupedItems: PublishedItem[];
  stats: PublishingStats;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UsePublishingOverviewOptions {
  enabled?: boolean;
}

interface PublishingCache {
  destinations: PublishDestination[];
  rawItems: PublishedItem[];
}

let cachedData: PublishingCache | null = null;

export const clearPublishingOverviewCache = (): void => {
  cachedData = null;
};

export const usePublishingOverview = (
  options: UsePublishingOverviewOptions = {}
): UsePublishingOverviewReturn => {
  const { enabled = true } = options;

  const [destinations, setDestinations] = useState<PublishDestination[]>(
    () => cachedData?.destinations ?? []
  );
  const [rawItems, setRawItems] = useState<PublishedItem[]>(
    () => cachedData?.rawItems ?? []
  );
  const [loading, setLoading] = useState<boolean>(enabled && cachedData === null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const [dests, items] = await Promise.all([
        getAllDestinations(),
        getAllCompletedPublishedItems(),
      ]);
      setDestinations(dests);
      setRawItems(items);
      cachedData = { destinations: dests, rawItems: items };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publishing overview');
      setDestinations([]);
      setRawItems([]);
      cachedData = null;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (cachedData !== null) return;
    fetchAll();
  }, [enabled, fetchAll]);

  const dedupedItems = useMemo(() => dedupPublishedItems(rawItems), [rawItems]);

  const stats = useMemo<PublishingStats>(() => {
    let models = 0;
    let decisions = 0;
    for (const item of dedupedItems) {
      const kind = getPublishedKind(item.sourceUri);
      if (kind === 'model') models++;
      else if (kind === 'decision') decisions++;
    }
    return {
      destinationCount: destinations.length,
      modelCount: models,
      decisionCount: decisions,
    };
  }, [destinations.length, dedupedItems]);

  return {
    destinations,
    dedupedItems,
    stats,
    loading,
    error,
    refresh: fetchAll,
  };
};
