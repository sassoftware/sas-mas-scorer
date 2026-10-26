// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRunningJobs,
  getCompletedJobs,
  walkJobs,
  jobsCreatedSinceFilter,
  JobStateCounts,
  AverageRuntimeResult,
} from '../api/jobs';
import { ExecutionJob, ExecutionJobState, isTerminalState } from '../types/jobExecution';
import { useDocumentVisibility, useOnBecameVisible } from './useDocumentVisibility';
import { registerViewCache } from '../utils/viewCaches';
import { pollRetryDelayMs } from '../utils/pollRetry';

const RUNNING_POLL_MS = 5_000;
const COMPLETED_POLL_MS = 30_000;

// Stats walk: page size and safety cap. 100 × 100 = 10 000 most-recent jobs
// in the chosen window. Refresh is incremental — see fetchStats below.
const STATS_PAGE_SIZE = 100;
const STATS_MAX_PAGES = 100;

// Pages kept in flight while a window is walked for the first time. Each
// page is about 1 MB (every job embeds its job definition and code) and takes
// 1–2 s, so reading ahead is what makes a cold walk fast. An incremental
// refresh usually ends after one page, so it walks one page at a time.
const STATS_COLD_CONCURRENCY = 4;

// Coming back to the tab re-walks the stats (one page when nothing changed)
// only when they are older than this, so flicking between tabs stays cheap.
const STATS_STALE_ON_RETURN_MS = 60_000;

// Up to 200 active jobs in one fetch — most tenants will have far fewer.
const RUNNING_LIMIT = 200;

export const DEFAULT_JOB_SORT = 'creationTimeStamp:descending';

export type CompletedStateFilter =
  | 'all'
  | Extract<ExecutionJobState, 'completed' | 'failed' | 'canceled' | 'timedOut'>;

// The period the summary statistics cover. A window walks only the jobs
// created in it (a ge(creationTimeStamp,…) filter), which on a busy tenant is
// a few pages instead of the 10 000-job cap. 'all' walks up to the cap.
export type JobStatsWindow = '24h' | '7d' | '30d' | 'all';

export const JOB_STATS_WINDOWS: readonly JobStatsWindow[] = ['24h', '7d', '30d', 'all'];

export const DEFAULT_JOB_STATS_WINDOW: JobStatsWindow = '7d';

const DAY_MS = 24 * 60 * 60 * 1000;

const WINDOW_MS: Record<JobStatsWindow, number | null> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  all: null,
};

export interface JobMonitoringStats {
  counts: JobStateCounts;
  averageRuntime: AverageRuntimeResult;
  // How many jobs we have in our in-memory map.
  scanned: number;
  // True when a walk hit STATS_MAX_PAGES with a full final page —
  // more jobs exist than we've scanned. The UI labels totals with a "+".
  truncated: boolean;
  // Wall-clock time of the most recent successful page update.
  lastUpdated: number;
  // The window these figures cover.
  window: JobStatsWindow;
}

export interface UseJobMonitoringOptions {
  enabled?: boolean;
  pageSize?: number;
  // The history query is owned by the caller (the page keeps it in the URL).
  // `search` is applied as given, so the caller debounces typing; changing
  // the query does not move `page`, the caller resets it.
  search?: string;
  stateFilter?: CompletedStateFilter;
  sortBy?: string;
  /** 0-based history page. */
  page?: number;
  /** Period the summary statistics cover. */
  statsWindow?: JobStatsWindow;
}

export interface UseJobMonitoringReturn {
  stats: JobMonitoringStats | null;
  statsLoading: boolean;
  statsError: string | null;
  // True while a stats walk is actually in flight (initial scan or refresh).
  statsScanning: boolean;
  // Creation time (epoch ms) of the oldest job the walk in flight has reached,
  // so the progress banner can say how far back it has got.
  statsReachedMs: number | null;

  runningJobs: ExecutionJob[];
  runningLoading: boolean;
  runningError: string | null;

  completedJobs: ExecutionJob[];
  completedLoading: boolean;
  completedError: string | null;
  // True when the most recent page came back full. Used by the table to
  // decide whether to enable the "Next" button — never the envelope `count`.
  completedHasMore: boolean;
  // Page size the service actually applied to the history.
  pageSize: number;

  refresh: () => void;
  refreshing: boolean;

  // When one or more sections failed: the earliest time (epoch ms) a section
  // retries by itself, and the latest error. Both null while all is well.
  pollingRetryAt: number | null;
  pollingError: string | null;
}

// --- Module-level cache -----------------------------------------------------
//
// Navigating away and back returns instantly, and a return visit does an
// *incremental* refresh: walk pages from the top until a full page comes back
// with no new or changed jobs. Each window keeps its own map, so switching
// back to a window already walked is instant too.

interface JobRecord {
  state: ExecutionJobState;
  // Creation time (epoch ms; NaN when unparseable), so jobs that age out of
  // the window can be dropped from the counts.
  createdMs: number;
  // Runtime counted into the average (0 when not counted).
  elapsedMs: number;
}

interface StatsCache {
  jobsById: Map<string, JobRecord>;
  completedCount: number;
  failedCount: number;
  otherCount: number;
  elapsedSum: number;
  elapsedCount: number;
  truncated: boolean;
  // True once a walk of this window ran to its end (or the cap). Until then
  // the map holds only part of the window, so the next walk must not stop at
  // the first page with nothing new on it.
  complete: boolean;
  // 0 until the first page has been counted.
  lastUpdated: number;
}

const statsCaches = new Map<JobStatsWindow, StatsCache>();
let cachedRunningJobs: ExecutionJob[] | null = null;

// Bumped on every clear. A page that is mounted while the session changes
// (logout and log in as someone else without leaving Job Monitoring) compares
// this against the generation it started from and starts over instead of
// walking the new server into the old server's map.
let cacheGeneration = 0;

export const clearJobMonitoringCache = (): void => {
  statsCaches.clear();
  cachedRunningJobs = null;
  cacheGeneration += 1;
};

// The shell clears this through the registry (logout, Electron connection
// switch), so Header/App never import the job monitoring hook.
registerViewCache('jobMonitoring', clearJobMonitoringCache);

const getStatsCache = (win: JobStatsWindow): StatsCache => {
  let cache = statsCaches.get(win);
  if (!cache) {
    cache = {
      jobsById: new Map(),
      completedCount: 0,
      failedCount: 0,
      otherCount: 0,
      elapsedSum: 0,
      elapsedCount: 0,
      truncated: false,
      complete: false,
      lastUpdated: 0,
    };
    statsCaches.set(win, cache);
  }
  return cache;
};

// Classify a state into the bucket the walk maintains a counter for. Active
// jobs are NOT bucketed here — the UI derives `active` from the running list,
// which is always-fresh via its 5 s poll.
const bucketOf = (state: ExecutionJobState): 'completed' | 'failed' | 'other' | null => {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (isTerminalState(state)) return 'other';
  return null;
};

const adjustBucket = (cache: StatsCache, state: ExecutionJobState, delta: 1 | -1): void => {
  const bucket = bucketOf(state);
  if (bucket === 'completed') cache.completedCount = Math.max(0, cache.completedCount + delta);
  else if (bucket === 'failed') cache.failedCount = Math.max(0, cache.failedCount + delta);
  else if (bucket === 'other') cache.otherCount = Math.max(0, cache.otherCount + delta);
};

// Count one job from a walked page:
//   - not in map → new → add, increment its bucket, add elapsedTime if completed
//   - in map with different state → state change → move it between buckets
//   - in map with same state → unchanged
// Returns true when the counts changed.
const recordJob = (cache: StatsCache, job: ExecutionJob): boolean => {
  const prev = cache.jobsById.get(job.id);
  if (prev && prev.state === job.state) return false;
  if (prev) adjustBucket(cache, prev.state, -1);
  adjustBucket(cache, job.state, 1);
  let elapsedMs = prev?.elapsedMs ?? 0;
  if (
    elapsedMs === 0 &&
    job.state === 'completed' &&
    typeof job.elapsedTime === 'number' &&
    job.elapsedTime > 0
  ) {
    elapsedMs = job.elapsedTime;
    cache.elapsedSum += elapsedMs;
    cache.elapsedCount += 1;
  }
  cache.jobsById.set(job.id, {
    state: job.state,
    createdMs: Date.parse(job.creationTimeStamp),
    elapsedMs,
  });
  return true;
};

const removeRecord = (cache: StatsCache, jobId: string): void => {
  const prev = cache.jobsById.get(jobId);
  if (!prev) return;
  adjustBucket(cache, prev.state, -1);
  if (prev.elapsedMs > 0) {
    cache.elapsedSum = Math.max(0, cache.elapsedSum - prev.elapsedMs);
    cache.elapsedCount = Math.max(0, cache.elapsedCount - 1);
  }
  cache.jobsById.delete(jobId);
};

// Drop the jobs that have aged out of the window since the last walk.
const pruneBefore = (cache: StatsCache, sinceMs: number): void => {
  const expired: string[] = [];
  cache.jobsById.forEach((record, id) => {
    if (record.createdMs < sinceMs) expired.push(id);
  });
  expired.forEach((id) => removeRecord(cache, id));
};

const snapshotOf = (cache: StatsCache, win: JobStatsWindow): JobMonitoringStats => ({
  counts: {
    // total is map size — i.e., distinct jobs seen in this window.
    total: cache.jobsById.size,
    // active is filled in by the consumer (useMemo below) from runningJobs.
    active: null,
    completed: cache.completedCount,
    failed: cache.failedCount,
    other: cache.otherCount,
  },
  averageRuntime: {
    averageMs: cache.elapsedCount > 0 ? Math.round(cache.elapsedSum / cache.elapsedCount) : 0,
    sampleSize: cache.elapsedCount,
  },
  scanned: cache.jobsById.size,
  truncated: cache.truncated,
  lastUpdated: cache.lastUpdated,
  window: win,
});

const cachedSnapshot = (win: JobStatsWindow): JobMonitoringStats | null => {
  const cache = statsCaches.get(win);
  return cache && cache.lastUpdated > 0 ? snapshotOf(cache, win) : null;
};

// Mutate the cached maps + counters to reflect a state change on a single
// job (e.g. running → canceled after the user cancels it), so the monitoring
// page picks it up the next time it mounts without a full walk. No-op for a
// window whose map does not hold the job.
export const updateJobStateInCache = (jobId: string, newState: ExecutionJobState): void => {
  statsCaches.forEach((cache) => {
    const prev = cache.jobsById.get(jobId);
    if (!prev || prev.state === newState) return;
    adjustBucket(cache, prev.state, -1);
    adjustBucket(cache, newState, 1);
    cache.jobsById.set(jobId, { ...prev, state: newState });
    cache.lastUpdated = Date.now();
  });
  // Drop the job from the running list cache if its new state is terminal.
  if (cachedRunningJobs && isTerminalState(newState)) {
    cachedRunningJobs = cachedRunningJobs.filter((j) => j.id !== jobId);
  }
};

// Remove a job entirely (e.g. after the user deletes it).
export const removeJobFromCache = (jobId: string): void => {
  statsCaches.forEach((cache) => {
    if (!cache.jobsById.has(jobId)) return;
    removeRecord(cache, jobId);
    cache.lastUpdated = Date.now();
  });
  if (cachedRunningJobs) {
    cachedRunningJobs = cachedRunningJobs.filter((j) => j.id !== jobId);
  }
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

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export const useJobMonitoring = (
  options: UseJobMonitoringOptions = {}
): UseJobMonitoringReturn => {
  const {
    enabled = true,
    pageSize = 50,
    search = '',
    stateFilter = 'all',
    sortBy = DEFAULT_JOB_SORT,
    page = 0,
    statsWindow = DEFAULT_JOB_STATS_WINDOW,
  } = options;
  const visible = useDocumentVisibility();

  // --- Stats ---
  const [stats, setStats] = useState<JobMonitoringStats | null>(() =>
    cachedSnapshot(statsWindow)
  );
  const [statsLoading, setStatsLoading] = useState<boolean>(
    () => enabled && cachedSnapshot(statsWindow) === null
  );
  const [statsScanning, setStatsScanning] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsReachedMs, setStatsReachedMs] = useState<number | null>(null);
  // Read by the walk, so fetchStats stays one stable callback.
  const statsWindowRef = useRef<JobStatsWindow>(statsWindow);
  statsWindowRef.current = statsWindow;
  // The cache generation this page's state belongs to; see cacheGeneration.
  const generationRef = useRef<number>(cacheGeneration);

  // --- Running ---
  const [runningJobs, setRunningJobs] = useState<ExecutionJob[]>(
    () => cachedRunningJobs ?? []
  );
  const [runningLoading, setRunningLoading] = useState<boolean>(
    enabled && cachedRunningJobs === null
  );
  const [runningError, setRunningError] = useState<string | null>(null);

  // --- Completed (paginated, server-side) ---
  const [completedJobs, setCompletedJobs] = useState<ExecutionJob[]>([]);
  const [completedHasMore, setCompletedHasMore] = useState<boolean>(false);
  const [completedLoading, setCompletedLoading] = useState<boolean>(enabled);
  const [completedError, setCompletedError] = useState<string | null>(null);
  // Page size the service actually applies (the echoed `limit`, if it caps
  // our request). The ref drives the page offset without re-creating
  // fetchCompleted; the state feeds the table's range labels.
  const effectivePageSizeRef = useRef<number>(pageSize);
  const [effectivePageSize, setEffectivePageSize] = useState<number>(pageSize);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Per-section recovery. A failed request no longer stops a section's
  // polling for good: the section retries by itself on a back-off schedule
  // (5 s, 10 s, 30 s, then every 60 s) and returns to its normal cadence on
  // the first success. `*RetryAt` is when the next retry fires (null while
  // healthy); the failure counters pick the step in the schedule.
  const [statsRetryAt, setStatsRetryAt] = useState<number | null>(null);
  const [runningRetryAt, setRunningRetryAt] = useState<number | null>(null);
  const [completedRetryAt, setCompletedRetryAt] = useState<number | null>(null);
  const statsFailuresRef = useRef(0);
  const runningFailuresRef = useRef(0);
  const completedFailuresRef = useRef(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Stats walk ---

  // Token bumped on every walk start; older walks abort when they observe a
  // newer token (e.g. user clicked Refresh again mid-walk, or switched window).
  const statsTokenRef = useRef(0);

  // The cache was cleared while this page stayed mounted (logout, then a
  // login as another user or against another server): drop the previous
  // session's figures and running list so the next walk starts cold.
  // Bumping the token aborts a walk still running for the old session.
  // Only refs and state setters are touched, so the callback is stable.
  const resetIfCacheCleared = useCallback((): void => {
    if (generationRef.current === cacheGeneration) return;
    generationRef.current = cacheGeneration;
    statsTokenRef.current += 1;
    setStats(null);
    setRunningJobs([]);
  }, []);

  // Walks /jobExecution/jobs from page 0 over the current window and counts
  // each job into the window's cache. After each page: setStats so the cards
  // update progressively. Stops at the first short page (end of the window),
  // at STATS_MAX_PAGES, or — when the window was already walked to its end
  // before — at the first full page with nothing new or changed on it.
  //
  // The window collections report no `count`, so the walk cannot be sized up
  // front. A first walk of a window therefore reads several pages ahead; an
  // incremental one usually exits after page 1, so it goes page by page.
  const fetchStats = useCallback(async (silent = false) => {
    if (!enabled) return;
    resetIfCacheCleared();
    const generation = cacheGeneration;
    const token = ++statsTokenRef.current;
    const win = statsWindowRef.current;
    const cache = getStatsCache(win);
    const windowMs = WINDOW_MS[win];
    const since = windowMs === null ? null : Date.now() - windowMs;
    if (since !== null) pruneBefore(cache, since);
    const incremental = cache.complete;
    if (!incremental) cache.truncated = false;

    const isCurrent = (): boolean =>
      token === statsTokenRef.current &&
      mountedRef.current &&
      generation === cacheGeneration;

    if (!silent) setStatsLoading(true);
    setStatsScanning(true);
    setStatsReachedMs(null);

    try {
      await walkJobs(
        async (walked) => {
          if (!isCurrent()) return false;

          let changesInPage = 0;
          let oldestMs: number | null = null;
          for (const job of walked.items) {
            if (recordJob(cache, job)) changesInPage += 1;
            const createdMs = Date.parse(job.creationTimeStamp);
            if (Number.isFinite(createdMs)) {
              oldestMs = oldestMs === null ? createdMs : Math.min(oldestMs, createdMs);
            }
          }

          // Mark truncated if we're at the safety cap with more behind us.
          if (walked.pageIndex === STATS_MAX_PAGES - 1 && walked.hasMore) {
            cache.truncated = true;
          }

          cache.lastUpdated = Date.now();
          setStats(snapshotOf(cache, win));
          if (oldestMs !== null) setStatsReachedMs(oldestMs);

          // Incremental stop: a full page with nothing new/changed means we
          // have caught up. Only valid when the window was walked to its end
          // before — a partial map has "unchanged" pages that hide new ones.
          if (incremental && walked.hasMore && changesInPage === 0) return false;
          return true;
        },
        {
          pageSize: STATS_PAGE_SIZE,
          maxPages: STATS_MAX_PAGES,
          filter: since === null ? undefined : jobsCreatedSinceFilter(since),
          concurrency: incremental ? 1 : STATS_COLD_CONCURRENCY,
        }
      );

      if (!isCurrent()) return;
      // The walk ran to its end (short page, cap or caught up), so the map
      // now covers the whole window. An aborted walk never gets here.
      cache.complete = true;
      if (cache.lastUpdated === 0) {
        // An empty window: no page was counted, but the figures are known.
        cache.lastUpdated = Date.now();
        setStats(snapshotOf(cache, win));
      }
      statsFailuresRef.current = 0;
      setStatsRetryAt(null);
      setStatsError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setStatsError(errorMessage(err, 'Failed to load job stats'));
      statsFailuresRef.current += 1;
      setStatsRetryAt(Date.now() + pollRetryDelayMs(statsFailuresRef.current));
    } finally {
      if (mountedRef.current && token === statsTokenRef.current) {
        if (!silent) setStatsLoading(false);
        setStatsScanning(false);
        setStatsReachedMs(null);
      }
    }
  }, [enabled, resetIfCacheCleared]);

  // --- Running ---

  const fetchRunning = useCallback(async (silent = false) => {
    if (!enabled) return;
    resetIfCacheCleared();
    const generation = cacheGeneration;
    if (!silent) {
      setRunningLoading(true);
      setRunningError(null);
    }
    try {
      const result = await getRunningJobs(RUNNING_LIMIT);
      if (!mountedRef.current) return;
      // The session changed while the request was out: the answer is the
      // previous server's, and the next poll fetches the new one.
      if (generation !== cacheGeneration) return;
      setRunningJobs(result.items);
      cachedRunningJobs = result.items;
      runningFailuresRef.current = 0;
      setRunningRetryAt(null);
      setRunningError(null);
    } catch (err) {
      if (!mountedRef.current || generation !== cacheGeneration) return;
      setRunningError(errorMessage(err, 'Failed to load running jobs'));
      runningFailuresRef.current += 1;
      setRunningRetryAt(Date.now() + pollRetryDelayMs(runningFailuresRef.current));
    } finally {
      if (mountedRef.current && !silent) setRunningLoading(false);
    }
  }, [enabled, resetIfCacheCleared]);

  // --- Completed (server-side paginated) ---

  const completedTickRef = useRef(0);

  const fetchCompleted = useCallback(async (silent = false) => {
    if (!enabled) return;
    const tick = ++completedTickRef.current;
    if (!silent) {
      setCompletedLoading(true);
      setCompletedError(null);
    }
    try {
      const result = await getCompletedJobs({
        start: page * effectivePageSizeRef.current,
        limit: pageSize,
        filter: buildCompletedFilter(search, stateFilter),
        sortBy,
      });
      if (!mountedRef.current) return;
      if (tick !== completedTickRef.current) return;
      // The service may cap the page below what we asked for. Its echoed
      // `limit` is the real page size: "more available" is measured against
      // it (a capped-but-full page still has more), and it becomes the page
      // stride so the next page starts where this one ended.
      const echoedLimit =
        typeof result.limit === 'number' && result.limit > 0 ? result.limit : pageSize;
      const appliedPageSize = Math.min(pageSize, echoedLimit);
      effectivePageSizeRef.current = appliedPageSize;
      setEffectivePageSize(appliedPageSize);
      setCompletedJobs(result.items);
      setCompletedHasMore(result.items.length > 0 && result.items.length >= appliedPageSize);
      completedFailuresRef.current = 0;
      setCompletedRetryAt(null);
      setCompletedError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (tick !== completedTickRef.current) return;
      setCompletedError(errorMessage(err, 'Failed to load completed jobs'));
      completedFailuresRef.current += 1;
      setCompletedRetryAt(Date.now() + pollRetryDelayMs(completedFailuresRef.current));
    } finally {
      if (mountedRef.current && tick === completedTickRef.current && !silent) {
        setCompletedLoading(false);
      }
    }
  }, [enabled, page, pageSize, search, stateFilter, sortBy]);

  // --- Initial load ---

  // Stats: on mount and whenever the window changes. A window already walked
  // shows its cached figures at once and refreshes incrementally; a new one
  // starts cold. Starting a walk aborts the previous window's walk.
  useEffect(() => {
    if (!enabled) return;
    const cached = cachedSnapshot(statsWindow);
    setStats(cached);
    // A retry pending for the previous window would restart this walk.
    statsFailuresRef.current = 0;
    setStatsRetryAt(null);
    fetchStats(cached !== null);
  }, [enabled, statsWindow, fetchStats]);

  useEffect(() => {
    if (!enabled) return;
    fetchRunning(cachedRunningJobs !== null);
    // Runs on mount (and when auth arrives) only; the poll below takes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    fetchCompleted();
  }, [fetchCompleted]);

  // --- Background polling ---

  const completedPollEligible =
    page === 0 && search === '' && stateFilter === 'all';

  useEffect(() => {
    if (!enabled || !visible || runningRetryAt !== null) return;
    const handle = setInterval(() => fetchRunning(true), RUNNING_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, runningRetryAt, fetchRunning]);

  useEffect(() => {
    if (!enabled || !visible || !completedPollEligible || completedRetryAt !== null) return;
    const handle = setInterval(() => fetchCompleted(true), COMPLETED_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, completedPollEligible, completedRetryAt, fetchCompleted]);

  // --- Automatic retries after errors (paused while the tab is hidden) ---

  useEffect(() => {
    if (!enabled || !visible || runningRetryAt === null) return;
    const handle = setTimeout(() => fetchRunning(true), Math.max(0, runningRetryAt - Date.now()));
    return () => clearTimeout(handle);
  }, [enabled, visible, runningRetryAt, fetchRunning]);

  useEffect(() => {
    if (!enabled || !visible || completedRetryAt === null) return;
    const handle = setTimeout(
      () => fetchCompleted(true),
      Math.max(0, completedRetryAt - Date.now())
    );
    return () => clearTimeout(handle);
  }, [enabled, visible, completedRetryAt, fetchCompleted]);

  useEffect(() => {
    if (!enabled || !visible || statsRetryAt === null) return;
    const handle = setTimeout(() => fetchStats(true), Math.max(0, statsRetryAt - Date.now()));
    return () => clearTimeout(handle);
  }, [enabled, visible, statsRetryAt, fetchStats]);

  // --- Back on the tab: catch up at once instead of on the next interval ---

  useOnBecameVisible(visible, () => {
    if (!enabled) return;
    fetchRunning(true);
    if (completedPollEligible || completedRetryAt !== null) fetchCompleted(true);
    const statsAge = stats ? Date.now() - stats.lastUpdated : Infinity;
    if (!statsScanning && (statsRetryAt !== null || statsAge > STATS_STALE_ON_RETURN_MS)) {
      fetchStats(true);
    }
  });

  // --- Manual refresh (also the banner's "Retry now") ---
  const refresh = useCallback(() => {
    if (!enabled) return;
    setRefreshing(true);
    statsFailuresRef.current = 0;
    runningFailuresRef.current = 0;
    completedFailuresRef.current = 0;
    setStatsRetryAt(null);
    setRunningRetryAt(null);
    setCompletedRetryAt(null);
    // Stats refresh is incremental — walks pages from the top and bails as
    // soon as a full page contains nothing new. Cheap on the API.
    Promise.all([fetchStats(true), fetchRunning(true), fetchCompleted(true)]).finally(
      () => {
        if (mountedRef.current) setRefreshing(false);
      }
    );
  }, [enabled, fetchStats, fetchRunning, fetchCompleted]);

  const retryTimes = [statsRetryAt, runningRetryAt, completedRetryAt].filter(
    (t): t is number => t !== null
  );
  const pollingRetryAt = retryTimes.length > 0 ? Math.min(...retryTimes) : null;
  const pollingError =
    pollingRetryAt === null ? null : statsError ?? runningError ?? completedError;

  // Splice runningJobs.length into the stats so the Active card always
  // matches what the running panel is showing. The running panel polls every
  // 5 s, so the Active KPI updates on the same cadence — including when
  // jobs *finish* (the walk's snapshot would be stale until the next
  // refresh, which is why we don't blend it in here). Active jobs are not
  // windowed: whatever is running now is current.
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
        window: statsWindow,
      };
    }
    return {
      ...stats,
      counts: {
        ...stats.counts,
        active: activeFromRunning,
      },
    };
  }, [stats, runningJobs.length, statsWindow]);

  return useMemo(
    () => ({
      stats: statsWithActive,
      statsLoading,
      statsScanning,
      statsError,
      statsReachedMs,
      runningJobs,
      runningLoading,
      runningError,
      completedJobs,
      completedLoading,
      completedError,
      completedHasMore,
      pageSize: effectivePageSize,
      refresh,
      refreshing,
      pollingRetryAt,
      pollingError,
    }),
    [
      statsWithActive,
      statsLoading,
      statsScanning,
      statsError,
      statsReachedMs,
      runningJobs,
      runningLoading,
      runningError,
      completedJobs,
      completedLoading,
      completedError,
      completedHasMore,
      effectivePageSize,
      refresh,
      refreshing,
      pollingRetryAt,
      pollingError,
    ]
  );
};
