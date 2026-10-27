// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// The parts of a batch run that are not React: the result and stats shapes,
// which failures are worth retrying and how long to wait, the circuit breaker
// that pauses a run whose recent rows all fail, the throughput/ETA estimate,
// and the key that groups error messages for the results triage.

import axios from 'axios';
import { StepOutput } from '../../types';
import { RowCheck } from '../../utils/expectedValues';

export interface BatchResult {
  rowIndex: number;
  input: Record<string, unknown>;
  output: StepOutput | null;
  error: string | null;
  executionTime: number; // in milliseconds, of the last attempt
  /** Automatic retries spent on this row after transient failures. */
  retries?: number;
  /** Expected output values of this row (output name → cell), when columns were mapped */
  expected?: Record<string, unknown>;
  /** The row's outputs checked against `expected`, computed once when the row was scored */
  check?: RowCheck;
}

export interface BatchStats {
  totalRuntime: number;
  avgRequestTime: number;
  successRate: number;
  fastestResponse: number;
  slowestResponse: number;
  medianResponse: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
}

/** What the progress card shows while a run is going. */
export interface BatchProgress {
  /** Rows finished (succeeded or failed), and the rows in this run */
  current: number;
  total: number;
  succeeded: number;
  failed: number;
  /** Automatic retries spent so far */
  retries: number;
  /** Rows per second over the recent window, or null until measurable */
  rate: number | null;
  /** Estimated time left in ms, or null until measurable */
  etaMs: number | null;
  /** The most recent error message, if any */
  lastError: string | null;
}

export const emptyProgress = (total: number): BatchProgress => ({
  current: 0,
  total,
  succeeded: 0,
  failed: 0,
  retries: 0,
  rate: null,
  etaMs: null,
  lastError: null,
});

// --- Transient failures and backoff ---

/** Automatic retries per row for a transient failure (so at most 3 attempts). */
export const MAX_TRANSIENT_RETRIES = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 8000;

// The API client turns 502/503/504 into this message and drops the status
// (src/api/client.ts), so the message is the only signal left for those.
const TEMPORARILY_UNAVAILABLE_RE = /temporarily unavailable \(HTTP 50[234]\)/i;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Whether a failed scoring request is worth sending again: a gateway or
 * overload answer (429, 502, 503, 504) or no answer at all (a dropped
 * connection). Not retried: a 500 (MAS reports errors in the module's own
 * code that way, and those fail the same way every time) and a client-side
 * timeout (the request already waited two minutes; a retry would mostly
 * triple that).
 */
export const isTransientFailure = (err: unknown): boolean => {
  if (axios.isCancel(err)) return false;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) {
      return err.code !== 'ECONNABORTED' && err.code !== 'ETIMEDOUT';
    }
    return TRANSIENT_STATUSES.has(status);
  }
  // A status, if the client ever attaches one to the Error it rejects with
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return TRANSIENT_STATUSES.has(status);
  return err instanceof Error && TEMPORARILY_UNAVAILABLE_RE.test(err.message);
};

/** Wait before retry number `attempt` (0-based): 1 s, 2 s, 4 s … capped, with jitter. */
export const backoffDelay = (attempt: number, random: () => number = Math.random): number => {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  // ±25% so parallel workers that failed together do not retry together
  return Math.round(base * (0.75 + random() * 0.5));
};

/** Resolve after `ms`, or as soon as `signal` aborts. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });

// --- Error grouping ---

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_NUMBER_RE = /\d{4,}(?:\.\d+)?/g;

/**
 * The key failures are grouped by: the message with ids and long numbers
 * (row numbers, record ids) masked, so "row 1043 failed" and "row 2210
 * failed" land in one group while "HTTP 503" and "HTTP 504" stay apart.
 */
export const errorGroupKey = (message: string): string =>
  message.replace(UUID_RE, '…').replace(LONG_NUMBER_RE, '#').replace(/\s+/g, ' ').trim();

// --- Circuit breaker ---

/** Consecutive failed rows that pause the run. */
export const BREAKER_THRESHOLD = 20;

export interface BreakerTrip {
  /** Group key of the most common message in the failing streak */
  key: string;
  /** That message, as first seen */
  message: string;
  /** Rows in the streak */
  streak: number;
}

/**
 * Pauses a run after BREAKER_THRESHOLD finished rows in a row have failed
 * (after their retries), so an expired session or a deleted module does not
 * send the rest of a 100k-row file into the same error. A success resets the
 * streak. Continuing acknowledges the streak's message: rows failing with it
 * no longer count, so a file whose rows fail for a data reason runs on, but a
 * different failure (the session expiring later) pauses again.
 */
export class CircuitBreaker {
  private streak = 0;
  private counts = new Map<string, { message: string; count: number }>();
  private readonly acknowledged = new Set<string>();

  constructor(private readonly threshold = BREAKER_THRESHOLD) {}

  /** Record a finished row; returns the trip when this row trips the breaker. */
  record(error: string | null): BreakerTrip | null {
    if (error === null) {
      this.reset();
      return null;
    }
    const key = errorGroupKey(error);
    // An acknowledged message neither counts nor breaks a streak
    if (this.acknowledged.has(key)) return null;
    this.streak++;
    const entry = this.counts.get(key);
    if (entry) entry.count++;
    else this.counts.set(key, { message: error, count: 1 });
    if (this.streak < this.threshold) return null;

    let trip: BreakerTrip = { key, message: error, streak: this.streak };
    let topCount = 0;
    for (const [k, v] of this.counts) {
      if (v.count > topCount) {
        topCount = v.count;
        trip = { key: k, message: v.message, streak: this.streak };
      }
    }
    return trip;
  }

  /**
   * The user chose to continue: stop counting the streak's main message and
   * start over. Other messages of the streak still count, so a mixed streak
   * pauses again sooner rather than later.
   */
  acknowledge(trip: BreakerTrip): void {
    this.acknowledged.add(trip.key);
    this.reset();
  }

  private reset(): void {
    this.streak = 0;
    this.counts = new Map();
  }
}

// --- Throughput and time left ---

/** Rows/s is measured over about this much recent time. */
const RATE_WINDOW_MS = 15_000;
/** No estimate before this much running time, or before this many rows. */
const RATE_MIN_ELAPSED_MS = 2_000;
const RATE_MIN_ROWS = 5;

/**
 * Rows per second over a sliding window of recent samples, so the ETA follows
 * a change in server speed instead of the whole run's average. Time spent
 * paused is excluded: `restart()` drops the samples.
 */
export class ThroughputMeter {
  private samples: { t: number; done: number }[] = [];

  sample(now: number, done: number): void {
    this.samples.push({ t: now, done });
    // Keep one sample older than the window as the window's baseline
    while (this.samples.length > 2 && now - this.samples[1].t > RATE_WINDOW_MS) {
      this.samples.shift();
    }
  }

  restart(now: number, done: number): void {
    this.samples = [{ t: now, done }];
  }

  rate(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsed = last.t - first.t;
    const rows = last.done - first.done;
    if (elapsed < RATE_MIN_ELAPSED_MS || rows < RATE_MIN_ROWS) return null;
    return (rows / elapsed) * 1000;
  }

  etaMs(remaining: number): number | null {
    const r = this.rate();
    if (r === null || r <= 0) return null;
    return (remaining / r) * 1000;
  }
}

// --- Stats ---

/** Run statistics in one pass (spreading 100k times into Math.min would overflow the stack). */
export const computeBatchStats = (results: BatchResult[], totalRuntime: number): BatchStats | null => {
  if (results.length === 0) return null;
  const executionTimes = new Float64Array(results.length);
  let sum = 0;
  let fastest = Infinity;
  let slowest = -Infinity;
  let successCount = 0;
  let errorCount = 0;
  results.forEach((r, i) => {
    const time = r.executionTime;
    executionTimes[i] = time;
    sum += time;
    if (time < fastest) fastest = time;
    if (time > slowest) slowest = time;
    if (r.error) errorCount++;
    else if (r.output) successCount++;
  });
  // A typed-array sort is numeric and allocates no per-element boxes
  const sortedTimes = executionTimes.sort();
  const mid = Math.floor(sortedTimes.length / 2);
  return {
    totalRuntime,
    avgRequestTime: sum / sortedTimes.length,
    successRate: (successCount / results.length) * 100,
    fastestResponse: fastest,
    slowestResponse: slowest,
    medianResponse: sortedTimes.length % 2 === 0
      ? (sortedTimes[mid - 1] + sortedTimes[mid]) / 2
      : sortedTimes[mid],
    totalRequests: results.length,
    successCount,
    errorCount,
  };
};

// --- Formatting ---

/** "42 s", "3 min", "1 h 05 min" — for an estimate, so no false precision. */
export const formatDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
};

export const formatRate = (rowsPerSecond: number): string =>
  rowsPerSecond >= 10 ? rowsPerSecond.toFixed(0) : rowsPerSecond.toFixed(1);
