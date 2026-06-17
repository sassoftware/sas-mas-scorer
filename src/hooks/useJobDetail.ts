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
import { useDocumentVisibility } from './useDocumentVisibility';

// While a job is running, refresh its overall record + log + listing fast
// enough that the user perceives a live tail.
const JOB_POLL_MS = 5_000;
const LOG_POLL_MS = 3_000;
const LOG_PAGE_SIZE = 100;

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

  refresh: () => void;
}

export const useJobDetail = (
  jobId: string | null,
  options: UseJobDetailOptions = {}
): UseJobDetailReturn => {
  const { enabled = true } = options;
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

  // Whether we have already loaded the terminal-state files for this job, so
  // we don't re-fetch them every poll tick once the job has finished.
  const terminalLogFetchedRef = useRef(false);
  const terminalListingFetchedRef = useRef(false);

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
    nextLogStartRef.current = 0;
    nextListingStartRef.current = 0;
    terminalLogFetchedRef.current = false;
    terminalListingFetchedRef.current = false;
  }, [jobId]);

  const fetchJob = useCallback(
    async (silent = false): Promise<ExecutionJob | null> => {
      if (!enabled || !jobId) return null;
      if (!silent) setJobLoading(true);
      setJobError(null);
      try {
        const next = await getJob(jobId);
        if (!mountedRef.current) return null;
        setJob(next);
        return next;
      } catch (err) {
        if (!mountedRef.current) return null;
        setJobError(err instanceof Error ? err.message : 'Failed to load job');
        return null;
      } finally {
        if (mountedRef.current && !silent) setJobLoading(false);
      }
    },
    [enabled, jobId]
  );

  // Drain as many live log/listing pages as exist beyond our current cursor.
  // The compute API caps each call at 100 lines; if a job spits out a backlog
  // faster than our 3 s tick, we keep paging until we catch up. The cap (5
  // pages = 500 lines per tick) is a safety belt against runaway loops.
  const drainLive = useCallback(
    async (
      sessionId: string,
      computeJobId: string,
      kind: 'log' | 'listing'
    ): Promise<void> => {
      const cursorRef = kind === 'log' ? nextLogStartRef : nextListingStartRef;
      const setLines = kind === 'log' ? setLogLines : setListingLines;
      const setErr = kind === 'log' ? setLogError : setListingError;
      const fetcher = kind === 'log' ? getComputeLog : getComputeListing;
      try {
        for (let i = 0; i < 5; i++) {
          const start = cursorRef.current;
          const page = await fetcher(sessionId, computeJobId, start, LOG_PAGE_SIZE);
          if (!mountedRef.current) return;
          const items = page.items ?? [];
          if (items.length === 0) break;
          cursorRef.current = start + items.length;
          setLines((prev) => [...prev, ...items]);
          if (items.length < LOG_PAGE_SIZE) break;
        }
        setErr(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setErr(err instanceof Error ? err.message : `Failed to load ${kind}`);
      }
    },
    []
  );

  // Fetch the .log.txt or .listing.txt file once per job for terminal state.
  const fetchTerminalFile = useCallback(
    async (
      currentJob: ExecutionJob,
      kind: 'log' | 'listing'
    ): Promise<void> => {
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
      setLoading(true);
      setErr(null);
      try {
        const text = await getFileContentText(uri);
        if (!mountedRef.current) return;
        setLines(splitTextToLogLines(text));
        fetchedRef.current = true;
      } catch (err) {
        if (!mountedRef.current) return;
        setErr(err instanceof Error ? err.message : `Failed to load ${kind} file`);
      } finally {
        if (mountedRef.current) setLoading(false);
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

  // Poll job record while running so we catch state transitions quickly.
  useEffect(() => {
    if (!enabled || !visible || !job) return;
    if (isTerminalState(job.state)) return;
    const handle = setInterval(() => fetchJob(true), JOB_POLL_MS);
    return () => clearInterval(handle);
  }, [enabled, visible, job, fetchJob]);

  // Live log/listing polling while running. Drain incrementally each tick.
  useEffect(() => {
    if (!enabled || !visible || !job) return;
    if (isTerminalState(job.state)) return;
    const ids = getComputeLogIds(job);
    if (!ids) return;
    const { sessionId, computeJobId } = ids;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([
        drainLive(sessionId, computeJobId, 'log'),
        drainLive(sessionId, computeJobId, 'listing'),
      ]);
    };
    tick();
    const handle = setInterval(tick, LOG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, visible, job, drainLive]);

  // Terminal-state files: fetch once per kind. The check on `*FetchedRef`
  // prevents re-fetching on every job-record refresh once we have the data.
  useEffect(() => {
    if (!enabled || !job || !isTerminalState(job.state)) return;
    if (!terminalLogFetchedRef.current) fetchTerminalFile(job, 'log');
    if (!terminalListingFetchedRef.current) fetchTerminalFile(job, 'listing');
  }, [enabled, job, fetchTerminalFile]);

  const refresh = useCallback(() => {
    if (!jobId) return;
    setLogLines([]);
    setListingLines([]);
    nextLogStartRef.current = 0;
    nextListingStartRef.current = 0;
    terminalLogFetchedRef.current = false;
    terminalListingFetchedRef.current = false;
    fetchJob();
  }, [jobId, fetchJob]);

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
  };
};
