// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// SAS Viya Job Execution + Compute log/listing + Files content endpoints.
// All requests use the generic `sasViyaClient` (no basePath) since these
// endpoints span multiple Viya services. The writes (cancel, delete, rerun)
// need no CSRF handling beyond what the shared interceptor already does.

import { sasViyaClient, SAS_CONTENT_TYPES } from './client';
import {
  ExecutionJob,
  ExecutionJobCollection,
  ExecutionJobDefinition,
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
  // The page size that was requested; the service may have applied a smaller one.
  pageSize: number;
  // True when this page came back full — measured against the limit the
  // service echoed back, never the requested size, and never the envelope
  // `count` — so another page exists.
  hasMore: boolean;
  // Total items received across all pages walked so far.
  cumulativeCount: number;
}

export interface WalkJobsOptions {
  pageSize?: number;
  // Safety cap on number of pages. Default 100 pages × up to 100 items/page,
  // i.e. 10k jobs when the service honours the requested page size, fewer
  // when it caps the page.
  maxPages?: number;
  // Extra filter clause, e.g. jobsCreatedSinceFilter(…) for a time window.
  filter?: string;
  // Page requests kept in flight at once, counting the one being processed.
  // 1 walks strictly page by page; more reads ahead while the caller works
  // through the current page.
  concurrency?: number;
}

// Filter clause for jobs created at or after `sinceMs` (epoch ms).
export const jobsCreatedSinceFilter = (sinceMs: number): string =>
  `ge(creationTimeStamp,'${new Date(sinceMs).toISOString()}')`;

// Walks /jobExecution/jobs page by page (newest-first), invoking `onPage`
// for each page in order. The walk stops when:
//   - the callback returns `false` (cooperative cancellation), or
//   - a page comes back shorter than the limit the service echoed (end of list), or
//   - `maxPages` is reached (safety cap).
// The envelope `count` is deliberately ignored: the job collections send none
// (filtered or not), and a degraded gateway may misreport it. Callers should
// treat `hasMore === true` on the final page as a signal that more jobs exist
// beyond what was scanned.
//
// With `concurrency` > 1 the next pages are requested while the current one
// is processed. Page 0 always goes alone: the limit it echoes is the stride
// for the rest (start = k × echoed limit). A page is about 1 MB because every
// job embeds its job definition and code, so the read-ahead is where a cold
// walk saves its time. Pages are still handed over strictly in order, and
// read-ahead requests still in flight when the walk stops are aborted.
export const walkJobs = async (
  onPage: (page: JobPage) => boolean | void | Promise<boolean | void>,
  options: WalkJobsOptions = {}
): Promise<void> => {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const controller = new AbortController();

  const requests = new Map<number, Promise<ExecutionJobCollection>>();
  let stride = pageSize;
  const request = (pageIndex: number): void => {
    if (pageIndex >= maxPages || requests.has(pageIndex)) return;
    const pending = sasViyaClient
      .get<ExecutionJobCollection>('/jobExecution/jobs', {
        params: {
          start: pageIndex * stride,
          limit: pageSize,
          sortBy: DEFAULT_SORT,
          filter: options.filter,
        },
        headers: { Accept: COLLECTION_ACCEPT },
        signal: controller.signal,
      })
      .then((response) => response.data);
    // A read-ahead page that is never awaited (the walk stopped first) must
    // not surface as an unhandled rejection; the awaited copy still throws.
    pending.catch(() => undefined);
    requests.set(pageIndex, pending);
  };

  let cumulativeCount = 0;
  request(0);
  try {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const pending = requests.get(pageIndex);
      if (!pending) break;
      const data = await pending;
      // Processed pages are not needed again; drop them so the ~1 MB
      // payloads can be collected during a long walk.
      requests.delete(pageIndex);
      const items = data.items ?? [];
      const effectiveLimit =
        typeof data.limit === 'number' && data.limit > 0 ? data.limit : pageSize;
      if (pageIndex === 0) stride = effectiveLimit;
      const hasMore = items.length > 0 && items.length >= effectiveLimit;
      cumulativeCount += items.length;

      // Keep the read-ahead going while the caller processes this page.
      if (hasMore) {
        for (let ahead = 1; ahead < concurrency; ahead++) request(pageIndex + ahead);
      }

      const cont = await onPage({
        items,
        pageIndex,
        pageSize,
        hasMore,
        cumulativeCount,
      });
      if (cont === false || !hasMore) break;
      request(pageIndex + 1);
    }
  } finally {
    controller.abort();
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

// --- Rerun: submit a finished job's request again --------------------------
//
// The job record has no rerun link, so the request is rebuilt from the
// stored jobRequest: name, the job definition (by URI when the request had
// one, else the embedded definition — most requests embed {type, code} and
// carry no jobDefinitionUri), the arguments and the properties. Ids, links
// and server-set fields are left out.

/**
 * Applications whose submitted jobs may be re-submitted here, lower case:
 * - jobexecution: the SAS Job Execution service and web app (job definitions
 *   and ad-hoc jobs). The request is the user's own program and arguments;
 *   running it again is what the Job Execution web app's resubmit does.
 * - sasstudio / studio: SAS Studio background submissions, likewise plain
 *   user programs.
 * Anything else is a service that submits jobs as part of its own work
 * (scoreExecution for score executions and SID tests, decisions for
 * publishing validations, datamining for Model Studio pipelines, the
 * scheduler, …). Those services keep their own record of each run; a job
 * re-submitted behind their back would run without that record and could
 * overwrite their outputs, so it is rerun from that application instead.
 */
const RERUNNABLE_APPLICATIONS = new Set(['jobexecution', 'sasjobexecution', 'sasstudio', 'studio']);

export interface RerunEligibility {
  allowed: boolean;
  /** Why rerun is not offered (when `allowed` is false). */
  reason?: string;
  /** The application that submitted the job, as recorded in its request. */
  application?: string;
  /** How the definition is sent again. */
  definition: 'uri' | 'embedded' | null;
}

export const getRerunEligibility = (job: ExecutionJob): RerunEligibility => {
  const request = job.jobRequest;
  const application = request?.createdByApplication ?? job.submittedByApplication;
  const definition: RerunEligibility['definition'] = request?.jobDefinitionUri
    ? 'uri'
    : request?.jobDefinition?.code
      ? 'embedded'
      : null;
  if (!definition) {
    return {
      allowed: false,
      application,
      definition,
      reason: 'the stored request has neither a job definition URI nor the definition code to run again.',
    };
  }
  if (application && !RERUNNABLE_APPLICATIONS.has(application.toLowerCase())) {
    return {
      allowed: false,
      application,
      definition,
      reason:
        `it was submitted by ${application}, which keeps its own record of each run. ` +
        'Re-submitting the job here would run it without that record, so run it again from that application.',
    };
  }
  return { allowed: true, application, definition };
};

/** The embedded definition without its id, links and server-set fields. */
const definitionForSubmit = (definition: ExecutionJobDefinition): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  if (definition.name) body.name = definition.name;
  if (definition.description) body.description = definition.description;
  if (definition.type) body.type = definition.type;
  if (definition.code !== undefined) body.code = definition.code;
  if (definition.parameters?.length) {
    body.parameters = definition.parameters.map(({ name, defaultValue, type, label, required }) => ({
      name,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(required !== undefined ? { required } : {}),
    }));
  }
  if (definition.properties?.length) body.properties = definition.properties;
  return body;
};

/**
 * The POST body that runs `job` again, with `args` as its arguments (the
 * original arguments when omitted).
 */
export const buildRerunRequest = (
  job: ExecutionJob,
  args?: Record<string, string>
): Record<string, unknown> => {
  const request = job.jobRequest;
  const body: Record<string, unknown> = {};
  if (request.name) body.name = request.name;
  if (request.description) body.description = request.description;
  if (request.jobDefinitionUri) {
    body.jobDefinitionUri = request.jobDefinitionUri;
  } else if (request.jobDefinition) {
    body.jobDefinition = definitionForSubmit(request.jobDefinition);
  }
  body.arguments = { ...(args ?? request.arguments ?? {}) };
  if (request.properties !== undefined && request.properties !== null) body.properties = request.properties;
  // Keeps the rerun listed where the original was (the Job Execution web app
  // filters on it); only rerunnable applications reach this point.
  if (request.createdByApplication) body.createdByApplication = request.createdByApplication;
  return body;
};

// POST /jobExecution/jobs — submit a job request; answers with the new job.
export const submitJob = async (request: Record<string, unknown>): Promise<ExecutionJob> => {
  const response = await sasViyaClient.post<ExecutionJob>('/jobExecution/jobs', request, {
    headers: {
      'Content-Type': 'application/json',
      Accept: JOB_ACCEPT,
    },
  });
  return response.data;
};

/** Run a finished job again; resolves with the new job. */
export const rerunJob = (job: ExecutionJob, args?: Record<string, string>): Promise<ExecutionJob> =>
  submitJob(buildRerunRequest(job, args));
