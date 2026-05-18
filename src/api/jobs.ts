// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// SAS Viya Job Execution + Compute log/listing + Files content endpoints.
// All requests use the generic `sasViyaClient` (no basePath) since these
// endpoints span multiple Viya services. All calls here are read-only — no
// CSRF token handling needed beyond what the shared interceptor already does.

import { sasViyaClient, SAS_CONTENT_TYPES } from './client';
import {
  ExecutionJob,
  ExecutionJobCollection,
  ExecutionJobState,
  LogLineCollection,
} from '../types/jobExecution';

const JOB_ACCEPT = 'application/vnd.sas.job.execution.job+json';
const COLLECTION_ACCEPT = SAS_CONTENT_TYPES.COLLECTION;
const DEFAULT_SORT = 'creationTimeStamp:descending';

// Filter clause covering all currently-active (non-terminal) job states.
const RUNNING_FILTER =
  "and(ne(state,'completed'),ne(state,'failed'),ne(state,'canceled'),ne(state,'timedOut'))";

// Filter clause covering all terminal states. Disjoint from RUNNING_FILTER
// so the running panel and the completed table never double-count a job.
const TERMINAL_FILTER =
  "or(eq(state,'completed'),eq(state,'failed'),eq(state,'canceled'),eq(state,'timedOut'))";

export interface GetJobsParams {
  start?: number;
  limit?: number;
  filter?: string;
  sortBy?: string;
}

export const getJobs = async (
  params: GetJobsParams = {}
): Promise<ExecutionJobCollection> => {
  const response = await sasViyaClient.get<ExecutionJobCollection>('/jobExecution/jobs', {
    params: {
      start: params.start ?? 0,
      limit: params.limit ?? 20,
      filter: params.filter,
      sortBy: params.sortBy ?? DEFAULT_SORT,
    },
    headers: { Accept: COLLECTION_ACCEPT },
  });
  return response.data;
};

export const getJob = async (jobId: string): Promise<ExecutionJob> => {
  const response = await sasViyaClient.get<ExecutionJob>(
    `/jobExecution/jobs/${encodeURIComponent(jobId)}`,
    { headers: { Accept: JOB_ACCEPT } }
  );
  return response.data;
};

export const getRunningJobs = async (limit = 50): Promise<ExecutionJobCollection> => {
  return getJobs({ filter: RUNNING_FILTER, limit });
};

export const getCompletedJobs = async (
  params: GetJobsParams = {}
): Promise<ExecutionJobCollection> => {
  const filter = params.filter
    ? `and(${TERMINAL_FILTER},${params.filter})`
    : TERMINAL_FILTER;
  return getJobs({ ...params, filter });
};

// Each field is nullable so the UI can render "—" for counts that haven't
// been fetched yet and progressively fill in values as they resolve.
export interface JobStateCounts {
  total: number | null;
  // `active` covers any non-terminal state: running, pending, paused.
  active: number | null;
  completed: number | null;
  failed: number | null;
  // Anything else (canceled, timedOut).
  other: number | null;
}

export const emptyJobStateCounts = (): JobStateCounts => ({
  total: null,
  active: null,
  completed: null,
  failed: null,
  other: null,
});

export interface AverageRuntimeResult {
  averageMs: number;
  sampleSize: number;
}

export interface JobPage {
  items: ExecutionJob[];
  pageIndex: number;
  pageSize: number;
  // True when this page came back full and another page likely exists. We
  // derive this from items.length only — never from the envelope `count`.
  hasMore: boolean;
  // Total items received across all pages walked so far.
  cumulativeCount: number;
}

export interface WalkJobsOptions {
  pageSize?: number;
  // Safety cap on number of pages. Default 100 pages × 100 items/page = 10k jobs.
  maxPages?: number;
}

// Walks /jobExecution/jobs page by page (newest-first), invoking `onPage`
// after each fetch. The walk stops when:
//   - the callback returns `false` (cooperative cancellation), or
//   - a page comes back with fewer than `pageSize` items (end of list), or
//   - `maxPages` is reached (safety cap).
// We rely entirely on items.length — never on the envelope `count` — so a
// degraded gateway that omits `count` still produces accurate numbers up to
// the cap. Callers should treat `hasMore === true` on the final page as a
// signal that more jobs exist beyond what was scanned.
export const walkJobs = async (
  onPage: (page: JobPage) => boolean | void | Promise<boolean | void>,
  options: WalkJobsOptions = {}
): Promise<void> => {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  let start = 0;
  let cumulative = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const collection = await getJobs({ start, limit: pageSize });
    const items = collection.items ?? [];
    cumulative += items.length;
    const hasMore = items.length === pageSize;
    const cont = await onPage({
      items,
      pageIndex,
      pageSize,
      hasMore,
      cumulativeCount: cumulative,
    });
    if (cont === false) return;
    if (!hasMore) return;
    start += pageSize;
  }
};

// --- Live log / listing for running jobs --------------------------------

export const getComputeLog = async (
  sessionId: string,
  computeJobId: string,
  start = 0,
  limit = 100
): Promise<LogLineCollection> => {
  const response = await sasViyaClient.get<LogLineCollection>(
    `/compute/sessions/${encodeURIComponent(sessionId)}/jobs/${encodeURIComponent(computeJobId)}/log`,
    {
      params: { start, limit },
      headers: { Accept: COLLECTION_ACCEPT },
    }
  );
  return response.data;
};

export const getComputeListing = async (
  sessionId: string,
  computeJobId: string,
  start = 0,
  limit = 100
): Promise<LogLineCollection> => {
  const response = await sasViyaClient.get<LogLineCollection>(
    `/compute/sessions/${encodeURIComponent(sessionId)}/jobs/${encodeURIComponent(computeJobId)}/listing`,
    {
      params: { start, limit },
      headers: { Accept: COLLECTION_ACCEPT },
    }
  );
  return response.data;
};

// Parse compute session/job IDs out of a job's `links[].rel === 'log'` href.
// Only the live form (/compute/sessions/.../log) yields an ID pair; the
// terminal form (/files/files/<id>) returns `null` because the file API is a
// different code path (see getFileContentText).
export interface ComputeLogIds {
  sessionId: string;
  computeJobId: string;
}

export const parseComputeLogHref = (href: string): ComputeLogIds | null => {
  const match = href.match(/\/compute\/sessions\/([^/]+)\/jobs\/([^/]+)\/log/);
  if (!match) return null;
  return { sessionId: match[1], computeJobId: match[2] };
};

export const getJobLogHref = (job: ExecutionJob): string | null => {
  const link = job.links.find((l) => l.rel === 'log');
  return link?.href ?? link?.uri ?? null;
};

export const getComputeLogIds = (job: ExecutionJob): ComputeLogIds | null => {
  const href = getJobLogHref(job);
  if (!href) return null;
  return parseComputeLogHref(href);
};

// --- Files API for terminal-state log/listing text ----------------------

// Locate the /files/files/<id> URI for a specific results entry by suffix
// (e.g. `.log.txt` or `.listing.txt`). The job's `results` map keys look like
// `<COMPUTE_JOB>.log.txt` so we match by suffix rather than exact key.
export const getResultFileUri = (
  job: ExecutionJob,
  suffix: '.log.txt' | '.listing.txt'
): string | null => {
  const results = job.results;
  if (!results) return null;
  const key = Object.keys(results).find((k) => k.endsWith(suffix));
  if (!key) return null;
  return results[key];
};

// Fetch the plain-text content of a /files/files/<id> resource. `fileUri`
// may already include `/content` or end at the resource itself; we normalise.
// We force `responseType: 'text'` and a no-op `transformResponse` because
// large SAS log files can otherwise be misinterpreted by axios' JSON parser.
export const getFileContentText = async (fileUri: string): Promise<string> => {
  const path = fileUri.endsWith('/content') ? fileUri : `${fileUri}/content`;
  const response = await sasViyaClient.get<string>(path, {
    headers: { Accept: 'text/plain' },
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return response.data;
};

// --- Mutating actions: cancel a running job, delete a finished job --------

// PUT /jobExecution/jobs/<id>/state with the new state as the request body.
// Body content-type is text/plain per the Viya Job Execution API.
export const updateJobState = async (
  jobId: string,
  state: ExecutionJobState
): Promise<void> => {
  await sasViyaClient.put(
    `/jobExecution/jobs/${encodeURIComponent(jobId)}/state`,
    state,
    {
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'text/plain',
      },
    }
  );
};

// DELETE /jobExecution/jobs/<id> — removes the job record, including the
// stored log/listing/result files attached to it. `Delegate-Domain` is
// documented but not required, so we leave it off.
export const deleteJob = async (jobId: string): Promise<void> => {
  await sasViyaClient.delete(`/jobExecution/jobs/${encodeURIComponent(jobId)}`, {
    headers: {
      Accept: 'application/json, application/vnd.sas.error+json',
    },
  });
};

// DELETE /compute/sessions/<id> — terminates the SAS process backing a
// running job. Used as the first step of cancelJob.
export const deleteComputeSession = async (sessionId: string): Promise<void> => {
  await sasViyaClient.delete(
    `/compute/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Accept: 'application/json, application/vnd.sas.error+json',
      },
    }
  );
};

// Cancel a non-terminal job. The order here matters: we PUT the state to
// "canceled" *first* and only then tear down the Compute session. Deleting
// the session first causes Job Execution to flip the state to "failed"
// (because the backing process disappeared), after which the state field
// becomes immutable and the cancel intent is lost. Session deletion errors
// are swallowed — by this point the job state is already canceled, so a
// missing/already-gone session is not a real failure.
export const cancelJob = async (job: ExecutionJob): Promise<void> => {
  await updateJobState(job.id, 'canceled');
  const ids = getComputeLogIds(job);
  if (ids) {
    try {
      await deleteComputeSession(ids.sessionId);
    } catch {
      // best-effort
    }
  }
};
