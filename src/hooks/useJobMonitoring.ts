// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRunningJobs,
  getCompletedJobs,
  walkJobs,
  emptyJobStateCounts,
  JobStateCounts,
  AverageRuntimeResult,
} from '../api/jobs';
import { ExecutionJob, ExecutionJobState, isTerminalState } from '../types/jobExecution';
import { useDocumentVisibility } from './useDocumentVisibility';

const RUNNING_POLL_MS = 5_000;
const COMPLETED_POLL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;

// Stats walk: page size and safety cap. 100 × 100 = 10 000 most-recent jobs
// on a cold start. Refresh is incremental — see fetchStats below.
const STATS_PAGE_SIZE = 100;
const STATS_MAX_PAGES = 100;

// Up to 200 active jobs in one fetch — most tenants will have far fewer.
const RUNNING_LIMIT = 200;

const DEFAULT_SORT = 'creationTimeStamp:descending';

export type CompletedStateFilter =
  | 'all'
  | Extract<ExecutionJobState, 'completed' | 'failed' | 'canceled' | 'timedOut'>;

export interface JobMonitoringStats {
  counts: JobStateCounts;
  averageRuntime: AverageRuntimeResult;
  // How many jobs we have in our in-memory map.
  scanned: number;
  // True when the initial walk hit STATS_MAX_PAGES with a full final page —
  // more jobs exist than we've scanned. The UI labels totals with a "+".
  truncated: boolean;
  // Wall-clock time of the most recent successful page update.
  lastUpdated: number;
}

export interface UseJobMonitoringOptions {
  enabled?: boolean;
  pageSize?: number;
}

export interface UseJobMonitoringReturn {
  stats: JobMonitoringStats | null;
  statsLoading: boolean;
  statsError: string | null;
  // True while a stats walk is actually in flight (initial scan or refresh).
  statsScanning: boolean;

  runningJobs: ExecutionJob[];
  runningLoading: boolean;
  runningError: string | null;

  completedJobs: ExecutionJob[];
  completedLoading: boolean;
  completedError: string | null;
  // True when the most recent page came back full. Used by the table to
  // decide whether to enable the "Next" button — never the envelope `count`.
  completedHasMore: boolean;
  page: number;
  pageSize: number;

  search: string;
  stateFilter: CompletedStateFilter;
  sortBy: string;

  setPage: (page: number) => void;
  setSearch: (search: string) => void;
  setStateFilter: (state: CompletedStateFilter) => void;
  setSortBy: (sortBy: string) => void;

  refresh: () => void;
  refreshing: boolean;

  pollingPaused: boolean;
}

// Module-level cache so navigating away and back returns instantly. We
// persist the full jobsById map and per-bucket counters so a return visit can
// do an *incremental* refresh — walk pages from the top until a full page
// comes back with no new/changed jobs.
interface JobMonitoringCache {
  stats: JobMonitoringStats;
  runningJobs: ExecutionJob[];
  jobsById: Map<string, ExecutionJobState>;
  completedCount: number;
  failedCount: number;
  otherCount: number;
  elapsedSum: number;
  elapsedCount: number;
  truncated: boolean;
}

let cachedData: JobMonitoringCache | null = null;

export const clearJobMonitoringCache = (): void => {
  cachedData = null;
};

// Build a fresh stats snapshot from the cached counters. Used by the
// targeted cache mutators below so the monitoring page picks up changes
// the next time it mounts, without paying for a full 10k-job walk.
const rebuildStatsFromCache = (cache: JobMonitoringCache): JobMonitoringStats => ({
  counts: {
    total: cache.jobsById.size,
    // active is overridden from runningJobs.length in the consumer.
    active: null,
    completed: cache.completedCount,
    failed: cache.failedCount,
    other: cache.otherCount,
  },
  averageRuntime: cache.stats.averageRuntime,
  scanned: cache.jobsById.size,
  truncated: cache.truncated,
  lastUpdated: Date.now(),
});

const bucketFor = (state: ExecutionJobState): 'completed' | 'failed' | 'other' | null => {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (isTerminalState(state)) return 'other';
  return null;
};

const decBucket = (cache: JobMonitoringCache, bucket: ReturnType<typeof bucketFor>): void => {
  if (bucket === 'completed') cache.completedCount = Math.max(0, cache.completedCount - 1);
  else if (bucket === 'failed') cache.failedCount = Math.max(0, cache.failedCount - 1);
  else if (bucket === 'other') cache.otherCount = Math.max(0, cache.otherCount - 1);
};

const incBucket = (cache: JobMonitoringCache, bucket: ReturnType<typeof bucketFor>): void => {
  if (bucket === 'completed') cache.completedCount += 1;
  else if (bucket === 'failed') cache.failedCount += 1;
  else if (bucket === 'other') cache.otherCount += 1;
};

// Mutate the cached map + counters to reflect a state change on a single
// job (e.g. running → canceled after the user cancels it). No-op when the
// job isn't already in the cache.
export const updateJobStateInCache = (
  jobId: string,
  newState: ExecutionJobState
): void => {
  if (!cachedData) return;
  const prev = cachedData.jobsById.get(jobId);
  if (prev === undefined || prev === newState) return;
  decBucket(cachedData, bucketFor(prev));
  incBucket(cachedData, bucketFor(newState));
  cachedData.jobsById.set(jobId, newState);
  // Drop the job from the running list cache if its new state is terminal.
  if (isTerminalState(newState)) {
    cachedData.runningJobs = cachedData.runningJobs.filter((j) => j.id !== jobId);
  }
  cachedData.stats = rebuildStatsFromCache(cachedData);
};

// Mutate the cached map + counters to remove a job entirely (e.g. after
// the user deletes it). No-op when the job isn't in the cache.
export const removeJobFromCache = (jobId: string): void => {
  if (!cachedData) return;
  const prev = cachedData.jobsById.get(jobId);
  if (prev !== undefined) {
    decBucket(cachedData, bucketFor(prev));
    cachedData.jobsById.delete(jobId);
  }
  cachedData.runningJobs = cachedData.runningJobs.filter((j) => j.id !== jobId);
  cachedData.stats = rebuildStatsFromCache(cachedData);
};

const buildCompletedFilter = (
  search: string,
  stateFilter: CompletedStateFilter
): string | undefined => {
  const escapedSearch = search.trim().replace(/'/g, "''");
  const clauses: string[] = [];
  if (escapedSearch) clauses.push(`contains(name,'${escapedSearch}')`);
  if (stateFilter !== 'all') clauses.push(`eq(state,'${stateFilter}')`);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return `and(${clauses.join(',')})`;
};

// Classify a state into the bucket the walk maintains a counter for. Active
// jobs are NOT bucketed here — the UI derives `active` from the running list,
// which is always-fresh via its 5 s poll.
type CountedBucket = 'completed' | 'failed' | 'other' | null;
const bucketOf = (state: ExecutionJobState): CountedBucket => {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (isTerminalState(state)) return 'other';
  return null;
};

export const useJobMonitoring = (
  options: UseJobMonitoringOptions = {}
): UseJobMonitoringReturn => {
  const { enabled = true, pageSize = 50 } = options;
  const visible = useDocumentVisibility();

  // --- Stats state (visible) ---
  const [stats, setStats] = useState<JobMonitoringStats | null>(
    () => cachedData?.stats ?? null
  );
  const [statsLoading, setStatsLoading] = useState<boolean>(
    enabled && cachedData === null
  );
  const [statsScanning, setStatsScanning] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // --- Stats refs (mutated by the walk; persisted to cachedData) ---
  const jobsByIdRef = useRef<Map<string, ExecutionJobState>>(
    cachedData?.jobsById ?? new Map()
  );
  const completedCountRef = useRef<number>(cachedData?.completedCount ?? 0);
  const failedCountRef = useRef<number>(cachedData?.failedCount ?? 0);
  const otherCountRef = useRef<number>(cachedData?.otherCount ?? 0);
  const elapsedSumRef = useRef<number>(cachedData?.elapsedSum ?? 0);
  const elapsedCountRef = useRef<number>(cachedData?.elapsedCount ?? 0);
  const truncatedRef = useRef<boolean>(cachedData?.truncated ?? false);

  // --- Running ---
  const [runningJobs, setRunningJobs] = useState<ExecutionJob[]>(
    () => cachedData?.runningJobs ?? []
  );
  const [runningLoading, setRunningLoading] = useState<boolean>(
    enabled && cachedData === null
  );
  const [runningError, setRunningError] = useState<string | null>(null);

  // --- Completed (paginated, server-side) ---
  const [completedJobs, setCompletedJobs] = useState<ExecutionJob[]>([]);
  const [completedHasMore, setCompletedHasMore] = useState<boolean>(false);
  const [completedLoading, setCompletedLoading] = useState<boolean>(enabled);
  const [completedError, setCompletedError] = useState<string | null>(null);
  const [page, setPageState] = useState<number>(0);
  const [search, setSearchState] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [stateFilter, setStateFilterState] = useState<CompletedStateFilter>('all');
  const [sortBy, setSortByState] = useState<string>(DEFAULT_SORT);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Per-section backoff so a degraded gateway doesn't keep getting hammered.
  const [statsBackoff, setStatsBackoff] = useState<boolean>(false);
  const [runningBackoff, setRunningBackoff] = useState<boolean>(false);
  const [completedBackoff, setCompletedBackoff] = useState<boolean>(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setPageState(0);
  }, [debouncedSearch, stateFilter, sortBy]);

  // --- Stats walk ---

  // Token bumped on every walk start; older walks abort when they observe a
  // newer token (e.g. user clicked Refresh again mid-walk).
  const statsTokenRef = useRef(0);

  // Apply +1/-1 to the counter for a given state. Active states have no
  // counter — they're derived from runningJobs.length on read.
  const adjustBucket = (state: ExecutionJobState, delta: 1 | -1): void => {
    const bucket = bucketOf(state);
    if (bucket === 'completed') completedCountRef.current += delta;
    else if (bucket === 'failed') failedCountRef.current += delta;
    else if (bucket === 'other') otherCountRef.current += delta;
  };

  const buildStatsSnapshot = (): JobMonitoringStats => ({
    counts: {
      // total is map size — i.e., distinct jobs we've ever seen this session.
      total: jobsByIdRef.current.size,
      // active is filled in by the consumer (useMemo below) from runningJobs.
      active: null,
      completed: completedCountRef.current,
      failed: failedCountRef.current,
      other: otherCountRef.current,
    },
    averageRuntime: {
      averageMs:
        elapsedCountRef.current > 0
          ? Math.round(elapsedSumRef.current / elapsedCountRef.current)
          : 0,
      sampleSize: elapsedCountRef.current,
    },
    scanned: jobsByIdRef.current.size,
    truncated: truncatedRef.current,
    lastUpdated: Date.now(),
  });

  const persistCache = (snapshot: JobMonitoringStats): void => {
    cachedData = {
      stats: snapshot,
      runningJobs: cachedData?.runningJobs ?? runningJobs,
      jobsById: jobsByIdRef.current,
      completedCount: completedCountRef.current,
      failedCount: failedCountRef.current,
      otherCount: otherCountRef.current,
      elapsedSum: elapsedSumRef.current,
      elapsedCount: elapsedCountRef.current,
      truncated: truncatedRef.current,
    };
  };

  // Walks /jobExecution/jobs from page 0. For each job:
  //   - not in map → new → add, increment its bucket, add elapsedTime if completed
  //   - in map with different state → state change → adjust buckets accordingly
  //   - in map with same state → unchanged
  // After each page: setStats so the cards update progressively. Stops when
  // a *full* page comes back with zero new/changed jobs, OR when items.length
  // is less than the page size (end of list), OR at STATS_MAX_PAGES.
  //
  // On a cold start the map is empty, so every job is "new" and we walk to
  // the end naturally. On a refresh with a populated map, the walk usually
  // exits after page 1 — the user gets near-instant feedback.
  const fetchStats = useCallback(async (silent = false) => {
    if (!enabled) return;
    const token = ++statsTokenRef.current;
    if (!silent) setStatsLoading(true);
    setStatsScanning(true);
    setStatsError(null);

    try {
      await walkJobs(
        async (page) => {
          if (token !== statsTokenRef.current || !mountedRef.current) return false;

          let changesInPage = 0;
          for (const job of page.items) {
            const prev = jobsByIdRef.current.get(job.id);
            if (prev === undefined) {
              // New to us — count it.
              jobsByIdRef.current.set(job.id, job.state);
              adjustBucket(job.state, 1);
              if (
                job.state === 'completed' &&
                typeof job.elapsedTime === 'number' &&
                job.elapsedTime > 0
              ) {
                elapsedSumRef.current += job.elapsedTime;
                elapsedCountRef.current += 1;
              }
              changesInPage += 1;
            } else if (prev !== job.state) {
              // State transition — reclassify.
              adjustBucket(prev, -1);
              adjustBucket(job.state, 1);
              jobsByIdRef.current.set(job.id, job.state);
              if (
                job.state === 'completed' &&
                prev !== 'completed' &&
                typeof job.elapsedTime === 'number' &&
                job.elapsedTime > 0
              ) {
                elapsedSumRef.current += job.elapsedTime;
                elapsedCountRef.current += 1;
              }
              changesInPage += 1;
            }
          }

          // Mark truncated if we're at the safety cap with more behind us.
          if (page.pageIndex === STATS_MAX_PAGES - 1 && page.hasMore) {
            truncatedRef.current = true;
          }

          const snapshot = buildStatsSnapshot();
          setStats(snapshot);
          persistCache(snapshot);

          // Incremental stop: a full page with nothing new/changed means we
          // have caught up. Only valid if we already had data — when the map
          // was empty going into this walk, every page contains "new" jobs.
          if (page.hasMore && changesInPage === 0) return false;
          return true;
        },
        { pageSize: STATS_PAGE_SIZE, maxPages: STATS_MAX_PAGES }
      );

      if (token !== statsTokenRef.current || !mountedRef.current) return;
      setStatsBackoff(false);
    } catch (err) {
      if (!mountedRef.current) return;
      if (token !== statsTokenRef.current) return;
      setStatsError(err instanceof Error ? err.message : 'Failed to load job stats');
      setStatsBackoff(true);
    } finally {
      if (mountedRef.current && token === statsTokenRef.current) {
        if (!silent) setStatsLoading(false);
        setStatsScanning(false);
      }
    }
    // Intentionally keyed on `enabled` only so the polling loop reuses one
    // stable callback; persistCache only writes to module-level cache/refs, so a
    // slightly stale closure has no observable effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // --- Running ---

  const fetchRunning = useCallback(async (silent = false) => {
    if (!enabled) return;
    if (!silent) setRunningLoading(true);
    setRunningError(null);
    try {
      const result = await getRunningJobs(RUNNING_LIMIT);
      if (!mountedRef.current) return;
      setRunningJobs(result.items);
      setRunningBackoff(false);
      cachedData = {
        stats: cachedData?.stats ?? {
          counts: emptyJobStateCounts(),
          averageRuntime: { averageMs: 0, sampleSize: 0 },
          scanned: 0,
          truncated: false,
          lastUpdated: 0,
        },
        runningJobs: result.items,
        jobsById: cachedData?.jobsById ?? jobsByIdRef.current,
        completedCount: cachedData?.completedCount ?? completedCountRef.current,
        failedCount: cachedData?.failedCount ?? failedCountRef.current,
        otherCount: cachedData?.otherCount ?? otherCountRef.current,
        elapsedSum: cachedData?.elapsedSum ?? elapsedSumRef.current,
        elapsedCount: cachedData?.elapsedCount ?? elapsedCountRef.current,
        truncated: cachedData?.truncated ?? truncatedRef.current,
      };
    } catch (err) {
      if (!mountedRef.current) return;
      setRunningError(err instanceof Error ? err.message : 'Failed to load running jobs');
      setRunningBackoff(true);
    } finally {
      if (mountedRef.current && !silent) setRunningLoading(false);
    }
  }, [enabled]);

  // --- Completed (server-side paginated) ---

  const completedTickRef = useRef(0);

  const fetchCompleted = useCallback(async (silent = false) => {
    if (!enabled) return;
    const tick = ++completedTickRef.current;
    if (!silent) setCompletedLoading(true);
    setCompletedError(null);
    try {
      const result = await getCompletedJobs({
        start: page * pageSize,
        limit: pageSize,
        filter: buildCompletedFilter(debouncedSearch, stateFilter),
        sortBy,
      });
      if (!mountedRef.current) return;
      if (tick !== completedTickRef.current) return;
      setCompletedJobs(result.items);
      setCompletedHasMore(result.items.length === pageSize);
      setCompletedBackoff(false);
    } catch (err) {
      if (!mountedRef.current) return;
      if (tick !== completedTickRef.current) return;
      setCompletedError(err instanceof Error ? err.message : 'Failed to load completed jobs');
      setCompletedBackoff(true);
    } finally {
      if (mountedRef.current && tick === completedTickRef.current && !silent) {
        setCompletedLoading(false);
      }
    }
  }, [enabled, page, pageSize, debouncedSearch, stateFilter, sortBy]);

  // --- Initial load ---

  useEffect(() => {
    if (!enabled) return;
    // Walk either way — when cached, the walk is incremental and usually
    // exits after page 1; when cold, it walks until end of list or cap.
    fetchStats(cachedData !== null);
    fetchRunning(cachedData !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    fetchCompleted();
  }, [fetchCompleted]);

  // --- Background polling ---

  useEffect(() => {
    if (!enabled || !visible || runningBackoff) return;
    const handle = setInterval(() => fetchRunning(true), RUNNING_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, runningBackoff, fetchRunning]);

  const completedPollEligible =
    page === 0 && debouncedSearch === '' && stateFilter === 'all';

  useEffect(() => {
    if (!enabled || !visible || !completedPollEligible || completedBackoff) return;
    const handle = setInterval(() => fetchCompleted(true), COMPLETED_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, completedPollEligible, completedBackoff, fetchCompleted]);

  // --- Manual refresh ---
  const refresh = useCallback(() => {
    if (!enabled) return;
    setRefreshing(true);
    setStatsBackoff(false);
    setRunningBackoff(false);
    setCompletedBackoff(false);
    // Stats refresh is incremental — walks pages from the top and bails as
    // soon as a full page contains nothing new. Cheap on the API.
    Promise.all([fetchStats(true), fetchRunning(true), fetchCompleted(true)]).finally(
      () => {
        if (mountedRef.current) setRefreshing(false);
      }
    );
  }, [enabled, fetchStats, fetchRunning, fetchCompleted]);

  const pollingPaused = statsBackoff || runningBackoff || completedBackoff;

  const setPage = useCallback((next: number) => setPageState(next), []);
  const setSearch = useCallback((next: string) => setSearchState(next), []);
  const setStateFilter = useCallback(
    (next: CompletedStateFilter) => setStateFilterState(next),
    []
  );
  const setSortBy = useCallback((next: string) => setSortByState(next), []);

  // Splice runningJobs.length into the stats so the Active card always
  // matches what the running panel is showing. The running panel polls every
  // 5 s, so the Active KPI updates on the same cadence — including when
  // jobs *finish* (the walk's snapshot would be stale until the next
  // refresh, which is why we don't blend it in here).
  const statsWithActive = useMemo<JobMonitoringStats | null>(() => {
    const activeFromRunning = runningJobs.length;
    if (!stats) {
      // No walk has produced data yet, but we may already have running jobs
      // from the always-fresh poll. Surface at least that part of the picture.
      if (activeFromRunning === 0) return null;
      return {
        counts: {
          total: null,
          active: activeFromRunning,
          completed: null,
          failed: null,
          other: null,
        },
        averageRuntime: { averageMs: 0, sampleSize: 0 },
        scanned: 0,
        truncated: false,
        lastUpdated: Date.now(),
      };
    }
    return {
      ...stats,
      counts: {
        ...stats.counts,
        active: activeFromRunning,
      },
    };
  }, [stats, runningJobs.length]);

  return useMemo(
    () => ({
      stats: statsWithActive,
      statsLoading,
      statsScanning,
      statsError,
      runningJobs,
      runningLoading,
      runningError,
      completedJobs,
      completedLoading,
      completedError,
      completedHasMore,
      page,
      pageSize,
      search,
      stateFilter,
      sortBy,
      setPage,
      setSearch,
      setStateFilter,
      setSortBy,
      refresh,
      refreshing,
      pollingPaused,
    }),
    [
      statsWithActive,
      statsLoading,
      statsScanning,
      statsError,
      runningJobs,
      runningLoading,
      runningError,
      completedJobs,
      completedLoading,
      completedError,
      completedHasMore,
      page,
      pageSize,
      search,
      stateFilter,
      sortBy,
      setPage,
      setSearch,
      setStateFilter,
      setSortBy,
      refresh,
      refreshing,
      pollingPaused,
    ]
  );
};
