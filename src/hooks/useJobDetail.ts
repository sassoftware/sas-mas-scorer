// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getJob,
  getComputeLog,
  getComputeListing,
  getComputeLogIds,
  getResultFileUri,
  getFileContentText,
} from '../api/jobs';
import {
  ExecutionJob,
  LogLine,
  LogLineType,
  isTerminalState,
} from '../types/jobExecution';
import { useDocumentVisibility, useOnBecameVisible } from './useDocumentVisibility';

// While a job is running, refresh its overall record and the visible output
// (log or listing) fast enough that the user perceives a live tail.
const JOB_POLL_MS = 5_000;
const LOG_POLL_MS = 3_000;
// Lines per request. The Compute log endpoint is only known to honour 100;
// a larger limit is unverified, so catch-up gets faster by paging back to
// back instead (see drainLive).
const LOG_PAGE_SIZE = 100;
// One drain pages until it reaches the tail, up to this many pages (20 000
// lines) — a safety belt against a service that ignores `start`. A longer
// backlog continues on the next tick.
const LIVE_MAX_PAGES_PER_DRAIN = 200;
// While catching up, lines are handed to React every this many pages, so a
// 30 000-line backlog is not 300 re-renders of a growing array.
const LIVE_PAGES_PER_APPEND = 10;

/** Which output a caller is showing; only that one is fetched live. */
export type JobOutputKind = 'log' | 'listing';

// All LogLineType values that we expect to find as a `<type>: ` prefix in
// the file-stored log/listing payload. Anything else falls back to the
// uppercase-SAS heuristic.
const KNOWN_LOG_TYPES = new Set<LogLineType>([
  'normal',
  'note',
  'warning',
  'error',
  'source',
  'title',
  'message',
  'byline',
  'footnote',
  'fatal',
  'highlighted',
]);

// Fallback heuristic for lines that don't carry an explicit type prefix —
// classify by the SAS-uppercase convention (NOTE:, WARNING:, ERROR:).
const classifyTextLine = (line: string): LogLineType => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('ERROR:')) return 'error';
  if (trimmed.startsWith('WARNING:')) return 'warning';
  if (trimmed.startsWith('NOTE:')) return 'note';
  return 'normal';
};

// The file-stored log/listing format (served from /files/files/<id>/content)
// collapses each `{ line, type }` JSON record onto one text line as
// `<type>: <line>` — e.g. `source: 1    options nosource;`. Parse the prefix
// back out so the renderer gets `{ line: "1    options nosource;",
// type: "source" }` and can colour-code without the prefix appearing in the
// visible content.
const splitTextToLogLines = (text: string): LogLine[] => {
  if (!text) return [];
  const raw = text.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  return raw.map((rawLine) => {
    const colonIdx = rawLine.indexOf(': ');
    // Cheap guard so we don't accidentally strip the start of, say, a CAS URL.
    if (colonIdx > 0 && colonIdx <= 12) {
      const candidate = rawLine.slice(0, colonIdx) as LogLineType;
      if (KNOWN_LOG_TYPES.has(candidate)) {
        return {
          line: rawLine.slice(colonIdx + 2),
          type: candidate,
          version: 1,
        };
      }
    }
    return { line: rawLine, type: classifyTextLine(rawLine), version: 1 };
  });
};

export interface UseJobDetailOptions {
  enabled?: boolean;
  /**
   * The output on screen. While the job runs only this one is polled; the
   * other catches up from its own cursor when it is shown. For a finished
   * job the saved log is always loaded (it names the failure) and the saved
   * listing only once it is shown. null (Code, Parameters) polls neither.
   */
  activeOutput?: JobOutputKind | null;
}

export interface UseJobDetailReturn {
  job: ExecutionJob | null;
  jobLoading: boolean;
  jobError: string | null;

  logLines: LogLine[];
  logLoading: boolean;
  logError: string | null;

  listingLines: LogLine[];
  listingLoading: boolean;
  listingError: string | null;

  /** Reload everything from scratch (the header's Refresh). */
  refresh: () => void;
  /**
   * Bring one output up to date without dropping what is shown: a running
   * job continues from the current cursor, a finished one reloads only that
   * saved file. The log viewer's "Refresh now" and Retry.
   */
  refreshOutput: (kind: JobOutputKind) => void;
}

export const useJobDetail = (
  jobId: string | null,
  options: UseJobDetailOptions = {}
): UseJobDetailReturn => {
  const { enabled = true, activeOutput = 'log' } = options;
  const visible = useDocumentVisibility();

  const [job, setJob] = useState<ExecutionJob | null>(null);
  const [jobLoading, setJobLoading] = useState<boolean>(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logLoading, setLogLoading] = useState<boolean>(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [listingLines, setListingLines] = useState<LogLine[]>([]);
  const [listingLoading, setListingLoading] = useState<boolean>(false);
  const [listingError, setListingError] = useState<string | null>(null);

  // Live-fetch cursors. Reset whenever we (re)load a job from scratch.
  const nextLogStartRef = useRef(0);
  const nextListingStartRef = useRef(0);

  // Per-kind in-flight flags so a second drain of the same kind can never
  // start while one is still running — two overlapping drains would both
  // read the cursor before either advances it and append the same page
  // twice. The epoch is bumped whenever the cursors are reset so a drain
  // that was already in flight discards its (now stale) results.
  const drainInFlightRef = useRef<{ log: boolean; listing: boolean }>({
    log: false,
    listing: false,
  });
  const drainEpochRef = useRef(0);

  // Bumped by refresh() so the live-poll effect restarts (and drains at
  // once) even though the job's id/state/compute ids are unchanged.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Whether we have already loaded the terminal-state files for this job, so
  // we don't re-fetch them every poll tick once the job has finished.
  const terminalLogFetchedRef = useRef(false);
  const terminalListingFetchedRef = useRef(false);
  // A saved file download already under way, so a re-render (the tab
  // switched, the record re-polled) does not start a second one.
  const terminalInFlightRef = useRef<{ log: boolean; listing: boolean }>({
    log: false,
    listing: false,
  });

  // The latest record, for callbacks that must not be re-created per poll.
  const jobRef = useRef<ExecutionJob | null>(job);
  jobRef.current = job;

  // The job this hook shows now. The page stays mounted when it moves to
  // another job (a rerun opens the new one, Back returns), so a request for
  // the previous job that answers late must not put that job back.
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const resetDrainState = useCallback((): void => {
    nextLogStartRef.current = 0;
    nextListingStartRef.current = 0;
    drainInFlightRef.current = { log: false, listing: false };
    terminalInFlightRef.current = { log: false, listing: false };
    drainEpochRef.current += 1;
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset all per-job state whenever the id changes.
  useEffect(() => {
    setJob(null);
    setJobError(null);
    setLogLines([]);
    setLogError(null);
    setListingLines([]);
    setListingError(null);
    setLogLoading(false);
    setListingLoading(false);
    resetDrainState();
    terminalLogFetchedRef.current = false;
    terminalListingFetchedRef.current = false;
  }, [jobId, resetDrainState]);

  const fetchJob = useCallback(
    async (silent = false): Promise<ExecutionJob | null> => {
      if (!enabled || !jobId) return null;
      if (!silent) setJobLoading(true);
      setJobError(null);
      const isCurrent = (): boolean => mountedRef.current && jobIdRef.current === jobId;
      try {
        const next = await getJob(jobId);
        if (!isCurrent()) return null;
        setJob(next);
        return next;
      } catch (err) {
        if (!isCurrent()) return null;
        setJobError(err instanceof Error ? err.message : 'Failed to load job');
        return null;
      } finally {
        if (isCurrent() && !silent) setJobLoading(false);
      }
    },
    [enabled, jobId]
  );

  // Drain as many live log/listing pages as exist beyond our current cursor.
  // The compute API returns at most 100 lines a call, so a backlog (opening
  // a job that has already written 30 000 lines, or coming back to the tab)
  // is paged back to back until a short page says we reached the tail —
  // instead of 500 lines per 3 s tick. Lines are appended in batches while
  // catching up. Skipped entirely when a drain of the same kind is still in
  // flight (a slow /compute call or a long catch-up outlasting the tick).
  const drainLive = useCallback(
    async (
      sessionId: string,
      computeJobId: string,
      kind: JobOutputKind
    ): Promise<void> => {
      if (drainInFlightRef.current[kind]) return;
      drainInFlightRef.current[kind] = true;
      const epoch = drainEpochRef.current;
      const cursorRef = kind === 'log' ? nextLogStartRef : nextListingStartRef;
      const setLines = kind === 'log' ? setLogLines : setListingLines;
      const setErr = kind === 'log' ? setLogError : setListingError;
      const fetcher = kind === 'log' ? getComputeLog : getComputeListing;
      // Lines received but not yet handed to React. The cursor has already
      // moved past them, so they must reach the state even if a later page
      // fails.
      let pending: LogLine[] = [];
      const flush = (): void => {
        if (pending.length === 0) return;
        const chunk = pending;
        pending = [];
        setLines((prev) => prev.concat(chunk));
      };
      const isCurrent = (): boolean =>
        mountedRef.current && epoch === drainEpochRef.current;
      try {
        for (let i = 0; i < LIVE_MAX_PAGES_PER_DRAIN; i++) {
          const start = cursorRef.current;
          const page = await fetcher(sessionId, computeJobId, start, LOG_PAGE_SIZE);
          if (!isCurrent()) return;
          const items = page.items ?? [];
          if (items.length === 0) break;
          cursorRef.current = start + items.length;
          pending.push(...items);
          if ((i + 1) % LIVE_PAGES_PER_APPEND === 0) flush();
          // Compare against the limit the service applied, so a service
          // that caps the page below 100 is not mistaken for the tail.
          const appliedLimit =
            typeof page.limit === 'number' && page.limit > 0 ? page.limit : LOG_PAGE_SIZE;
          if (items.length < Math.min(appliedLimit, LOG_PAGE_SIZE)) break;
        }
        flush();
        setErr(null);
      } catch (err) {
        if (!isCurrent()) return;
        flush();
        setErr(err instanceof Error ? err.message : `Failed to load ${kind}`);
      } finally {
        // A reset (new job / refresh) already cleared the flags for the new
        // epoch; only a drain that is still current may release its own.
        if (epoch === drainEpochRef.current) drainInFlightRef.current[kind] = false;
      }
    },
    []
  );

  // Fetch the .log.txt or .listing.txt file once per job for terminal state.
  // The lines on screen stay until the file has arrived and replace them.
  const fetchTerminalFile = useCallback(
    async (
      currentJob: ExecutionJob,
      kind: JobOutputKind
    ): Promise<void> => {
      if (terminalInFlightRef.current[kind]) return;
      const suffix = kind === 'log' ? '.log.txt' : '.listing.txt';
      const setLines = kind === 'log' ? setLogLines : setListingLines;
      const setErr = kind === 'log' ? setLogError : setListingError;
      const setLoading = kind === 'log' ? setLogLoading : setListingLoading;
      const fetchedRef =
        kind === 'log' ? terminalLogFetchedRef : terminalListingFetchedRef;
      const uri = getResultFileUri(currentJob, suffix);
      if (!uri) {
        // Some terminal states (e.g. failed before producing any output)
        // legitimately have no file. Surface a friendly empty state.
        setLines([]);
        fetchedRef.current = true;
        return;
      }
      const epoch = drainEpochRef.current;
      const isCurrent = (): boolean =>
        mountedRef.current && epoch === drainEpochRef.current;
      terminalInFlightRef.current[kind] = true;
      setLoading(true);
      setErr(null);
      try {
        const text = await getFileContentText(uri);
        if (!isCurrent()) return;
        setLines(splitTextToLogLines(text));
        fetchedRef.current = true;
      } catch (err) {
        if (!isCurrent()) return;
        setErr(err instanceof Error ? err.message : `Failed to load ${kind} file`);
      } finally {
        if (isCurrent()) {
          terminalInFlightRef.current[kind] = false;
          setLoading(false);
        }
      }
    },
    []
  );

  // Initial job load when jobId / enabled changes. Kicks the polling loops
  // below into life via the resulting `job` state.
  useEffect(() => {
    if (!enabled || !jobId) return;
    fetchJob();
  }, [enabled, jobId, fetchJob]);

  // The polling effects key on these primitives, never on `job` itself: the
  // record is replaced by a fresh object on every 5 s poll, and keying on it
  // would tear down and re-subscribe both intervals (with an extra immediate
  // drain) each time. The compute ids are included because they only appear
  // once the job record carries its log href.
  const jobKey = job?.id ?? null;
  const jobIsTerminal = job ? isTerminalState(job.state) : true;
  const computeIds = job ? getComputeLogIds(job) : null;
  const sessionId = computeIds?.sessionId ?? null;
  const computeJobId = computeIds?.computeJobId ?? null;

  // Poll job record while running so we catch state transitions quickly.
  useEffect(() => {
    if (!enabled || !visible || !jobKey || jobIsTerminal) return;
    const handle = setInterval(() => fetchJob(true), JOB_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, jobKey, jobIsTerminal, fetchJob]);

  // Back on the tab: re-read the record at once rather than up to 5 s later.
  // (The live drain below restarts with an immediate drain by itself, since
  // it depends on `visible`.)
  useOnBecameVisible(visible, () => {
    if (enabled && jobKey && !jobIsTerminal) fetchJob(true);
  });

  // Live polling of the output on screen while running. Each kind keeps its
  // own cursor, so switching tabs starts the newly shown one from where it
  // left off (an immediate drain that catches up), and the hidden one costs
  // no requests.
  useEffect(() => {
    if (!enabled || !visible || !jobKey || jobIsTerminal) return;
    if (!sessionId || !computeJobId || !activeOutput) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      drainLive(sessionId, computeJobId, activeOutput);
    };
    tick();
    const handle = setInterval(tick, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [
    enabled,
    visible,
    jobKey,
    jobIsTerminal,
    sessionId,
    computeJobId,
    activeOutput,
    refreshNonce,
    drainLive,
  ]);

  // Terminal-state files: fetch once per kind. The check on `*FetchedRef`
  // prevents re-fetching on every job-record refresh once we have the data.
  // The log is always loaded (the detail header names the first error);
  // the listing only once its tab is shown.
  useEffect(() => {
    if (!enabled || !job || !isTerminalState(job.state)) return;
    if (!terminalLogFetchedRef.current) fetchTerminalFile(job, 'log');
    if (activeOutput === 'listing' && !terminalListingFetchedRef.current) {
      fetchTerminalFile(job, 'listing');
    }
  }, [enabled, job, activeOutput, fetchTerminalFile]);

  const refresh = useCallback(() => {
    if (!jobId) return;
    setLogLines([]);
    setListingLines([]);
    setLogLoading(false);
    setListingLoading(false);
    resetDrainState();
    terminalLogFetchedRef.current = false;
    terminalListingFetchedRef.current = false;
    setRefreshNonce((n) => n + 1);
    fetchJob();
  }, [jobId, fetchJob, resetDrainState]);

  const refreshOutput = useCallback(
    (kind: JobOutputKind) => {
      const current = jobRef.current;
      if (!enabled || !current) return;
      if (isTerminalState(current.state)) {
        // A finished job's file is complete; reload just this one (also the
        // Retry after a failed download). The old lines stay until it lands.
        if (kind === 'log') terminalLogFetchedRef.current = false;
        else terminalListingFetchedRef.current = false;
        fetchTerminalFile(current, kind);
        return;
      }
      // Running: pick up a state change, and fetch from the current cursor.
      fetchJob(true);
      const ids = getComputeLogIds(current);
      if (ids) drainLive(ids.sessionId, ids.computeJobId, kind);
    },
    [enabled, fetchJob, drainLive, fetchTerminalFile]
  );

  return {
    job,
    jobLoading,
    jobError,
    logLines,
    logLoading,
    logError,
    listingLines,
    listingLoading,
    listingError,
    refresh,
    refreshOutput,
  };
};
