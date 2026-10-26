// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAllDestinations,
  getAllCompletedPublishedItems,
} from '../api/modelPublish';
import { PublishDestination, PublishedItem } from '../types/modelPublish';
import { dedupPublishedItems, getPublishedKind } from '../utils/publishHelpers';
import { registerViewCache } from '../utils/viewCaches';

export interface PublishingStats {
  destinationCount: number;
  modelCount: number;
  decisionCount: number;
}

/** Live counts while the overview loads, so the wait is visibly advancing. */
export interface PublishingProgress {
  destinationsLoaded: number;
  destinationsComplete: boolean;
  itemsLoaded: number;
  itemsComplete: boolean;
  /** Page requests made for the deployed items, which is the slow half. */
  itemPages: number;
}

const EMPTY_PROGRESS: PublishingProgress = {
  destinationsLoaded: 0,
  destinationsComplete: false,
  itemsLoaded: 0,
  itemsComplete: false,
  itemPages: 0,
};

export interface DestinationCounts {
  models: number;
  decisions: number;
}

interface UsePublishingOverviewReturn {
  destinations: PublishDestination[];
  dedupedItems: PublishedItem[];
  stats: PublishingStats;
  destinationCounts: Record<string, DestinationCounts>;
  /** First load: nothing to show yet. */
  loading: boolean;
  /** A reload while the previous data stays on screen. */
  refreshing: boolean;
  /** When the data on screen was read from SAS Viya (epoch ms), or null. */
  loadedAt: number | null;
  progress: PublishingProgress;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UsePublishingOverviewOptions {
  enabled?: boolean;
}

interface PublishingCache {
  destinations: PublishDestination[];
  rawItems: PublishedItem[];
  loadedAt: number;
}

let cachedData: PublishingCache | null = null;

// Bumped on every clear, so a load that was running when the session changed
// (logout, connection switch) does not store the old server's answer.
let cacheGeneration = 0;

export const clearPublishingOverviewCache = (): void => {
  cachedData = null;
  cacheGeneration += 1;
};

// The shell clears this through the registry, so Header/App never import the
// publishing hook (which would pull it into the entry chunk).
registerViewCache('publishing', clearPublishingOverviewCache);

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
  const [loadedAt, setLoadedAt] = useState<number | null>(() => cachedData?.loadedAt ?? null);
  const [loading, setLoading] = useState<boolean>(enabled && cachedData === null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PublishingProgress>(EMPTY_PROGRESS);

  // Whether data is on screen, read by fetchAll without re-creating it.
  const loadedAtRef = useRef<number | null>(loadedAt);
  loadedAtRef.current = loadedAt;
  // The generation this page's data belongs to, and the load in flight.
  const generationRef = useRef<number>(cacheGeneration);
  const loadTokenRef = useRef(0);

  // Stale-while-revalidate: the first load shows the progress card; a
  // refresh keeps the stats, destinations and table (with its search,
  // filters and page) on screen and swaps the data in when it arrives. A
  // failed refresh keeps the previous data and reports the error.
  const fetchAll = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (generationRef.current !== cacheGeneration) {
      // The session changed under this page: what it shows is the previous
      // server's, so this load starts from nothing.
      generationRef.current = cacheGeneration;
      setDestinations([]);
      setRawItems([]);
      setLoadedAt(null);
      loadedAtRef.current = null;
    }
    const generation = cacheGeneration;
    const token = ++loadTokenRef.current;
    const isCurrent = (): boolean =>
      token === loadTokenRef.current && generation === cacheGeneration;
    const isRefresh = loadedAtRef.current !== null;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setProgress(EMPTY_PROGRESS);

    try {
      const [dests, items] = await Promise.all([
        getAllDestinations((page) => {
          if (!isCurrent()) return;
          setProgress((prev) => ({ ...prev, destinationsLoaded: page.loaded }));
        }).then((result) => {
          if (isCurrent()) {
            setProgress((prev) => ({
              ...prev,
              destinationsLoaded: result.length,
              destinationsComplete: true,
            }));
          }
          return result;
        }),
        getAllCompletedPublishedItems((page) => {
          if (!isCurrent()) return;
          setProgress((prev) => ({
            ...prev,
            itemsLoaded: page.loaded,
            itemPages: page.page,
          }));
        }).then((result) => {
          if (isCurrent()) {
            setProgress((prev) => ({
              ...prev,
              itemsLoaded: result.length,
              itemsComplete: true,
            }));
          }
          return result;
        }),
      ]);
      if (!isCurrent()) return;
      const now = Date.now();
      setDestinations(dests);
      setRawItems(items);
      setLoadedAt(now);
      cachedData = { destinations: dests, rawItems: items, loadedAt: now };
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : 'Failed to load publishing overview');
      if (!isRefresh) {
        setDestinations([]);
        setRawItems([]);
        cachedData = null;
      }
    } finally {
      if (token === loadTokenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (cachedData !== null) return;
    fetchAll();
  }, [enabled, fetchAll]);

  const dedupedItems = useMemo(() => dedupPublishedItems(rawItems), [rawItems]);

  const destinationCounts = useMemo<Record<string, DestinationCounts>>(() => {
    const counts: Record<string, DestinationCounts> = {};
    for (const item of dedupedItems) {
      const key = item.destinationName;
      if (!key) continue;
      const kind = getPublishedKind(item.sourceUri);
      if (kind !== 'model' && kind !== 'decision') continue;
      const entry = counts[key] ?? { models: 0, decisions: 0 };
      if (kind === 'model') entry.models++;
      else entry.decisions++;
      counts[key] = entry;
    }
    return counts;
  }, [dedupedItems]);

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
    destinationCounts,
    loading,
    refreshing,
    loadedAt,
    progress,
    error,
    refresh: fetchAll,
  };
};
