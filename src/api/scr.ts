// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SAS Container Runtime (SCR) endpoints, reached with nothing but the
 * endpoint URL the user pasted.
 *
 * Three images answer here, told apart only by what they serve over HTTP:
 * - SAS Container Runtime (SAS models, decisions, rule sets):
 *   GET  {score}/apiMeta/api   OpenAPI 3.1, "SAS Container Runtime: <name>",
 *                              SCRInput/SCROutput, or MicroBatchInput/Output
 *                              when the container runs in batch mode
 *   POST {score}               {data:{…}} → {metadata, data}
 *   GET  {base}/prometheus     runtime metrics
 * - SAS Python Runtime, and the older open-source Python image (Flasgger,
 *   Swagger 2.0) that Model Manager builds for Python models:
 *   GET  {score}/apiMeta/api   PCRInput/PCROutput with type decimal|string,
 *                              length, level and description per variable
 *   POST {score}               same body; every input is required (422)
 *   GET  {base}/query/{id}/log the log of one request, also of a failed one
 *
 * No image serves its version, its logs (other than Python's per-request
 * log), or which kind of SAS content it holds over HTTP; the step id in a
 * score response (score / execute / scoreModel) is the only runtime hint.
 * Nothing here guesses beyond what an endpoint answered.
 *
 * Requests use fetch without credentials: SCR has no CORS support, so the web
 * and Job Execution builds can only reach an endpoint served from their own
 * origin (an SCR routed under the Viya ingress host). Electron reaches any URL.
 */

import type { Step, StepParameter } from '../types';
import { createBridgeFetch, isElectronBridgeAvailable } from './electronFetch';

export type ScrRuntime = 'scr' | 'python' | 'python-legacy' | 'unknown';
export type ScrMode = 'single' | 'batch';

export interface ScrVariable {
  name: string;
  type: 'number' | 'string';
  /** Maximum characters for a string (SCR maxLength, Python length). */
  length?: number;
  description?: string;
  /** Python only: interval, nominal, … as recorded in Model Manager. */
  level?: string;
}

export interface ScrEndpointInfo {
  /** The URL scores are posted to: {base}/{name}. */
  scoreUrl: string;
  /** Everything before the last path segment. */
  baseUrl: string;
  /** The last path segment: the module/model name, case as served. */
  name: string;
  /** The signature document's title, e.g. "SAS Container Runtime: gb_test_risk". */
  title: string;
  runtime: ScrRuntime;
  mode: ScrMode;
  specVersion: string;
  inputs: ScrVariable[];
  outputs: ScrVariable[];
  /** Python images: every input must be present (the image answers 422 otherwise). */
  inputsRequired: boolean;
  /** Python images: POST {base}/executions + GET {base}/query/{id}/log exist. */
  hasRequestLog: boolean;
  tls: boolean;
}

export interface ScrHealth {
  live: boolean | null;
  ready: boolean | null;
}

export interface ScrMetrics {
  hits: number | null;
  executions: number | null;
  /** Sum of execution times in milliseconds, as SCR reports it. */
  executionMsTotal: number | null;
  memoryUsedBytes: number | null;
  busyWorkers: number | null;
  threadPoolSize: number | null;
}

/** What a score response says about itself. */
export interface ScrResponseMetadata {
  moduleId?: string;
  stepId?: string;
  elapsedNanos?: number;
  timestamp?: string;
  transactionId?: string;
  /** Python: the request id, which names its log. */
  requestId?: string;
  [key: string]: unknown;
}

export interface ScrScoreResult {
  ok: boolean;
  status: number;
  outputs: Record<string, unknown>;
  metadata: ScrResponseMetadata;
  /** The response body as received. */
  raw: unknown;
  /** Round trip measured here, in milliseconds. */
  durationMs: number;
  error?: string;
}

export interface ScrBatchRowResult {
  rowId: number;
  outputs: Record<string, unknown>;
  metadata: ScrResponseMetadata;
}

export interface ScrBatchResult {
  ok: boolean;
  status: number;
  rows: ScrBatchRowResult[];
  elapsedNanos?: number;
  raw: unknown;
  durationMs: number;
  error?: string;
}

/** A request the endpoint could not be reached for at all. */
export class ScrNetworkError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = 'ScrNetworkError';
  }
}

const isElectron = (): boolean => typeof window !== 'undefined' && !!window.electronAPI;

/**
 * Trims a pasted URL to the score URL: no query, hash or trailing slash, and
 * no `/apiMeta/api` if the signature URL was pasted instead.
 */
export function normalizeScoreUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter the endpoint URL.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('That is not a URL. Paste the full address, e.g. https://host/model_name.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The URL must start with http:// or https://.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/apiMeta\/api$/i, '');
  if (!path || path === '/') {
    throw new Error(
      'Add the model name to the URL: SCR scores at /{name}, e.g. ' + `${url.origin}/my_model.`
    );
  }
  return `${url.origin}${path}`;
}

export function splitScoreUrl(scoreUrl: string): { baseUrl: string; name: string } {
  const index = scoreUrl.lastIndexOf('/');
  return { baseUrl: scoreUrl.slice(0, index), name: decodeURIComponent(scoreUrl.slice(index + 1)) };
}

/** Whether the browser will let this page call the URL (same origin, or Electron). */
export function reachableFromHere(url: string): { reachable: boolean; reason?: string } {
  if (isElectron()) return { reachable: true };
  try {
    if (new URL(url).origin === window.location.origin) return { reachable: true };
  } catch {
    return { reachable: false, reason: 'Invalid URL.' };
  }
  return {
    reachable: false,
    reason:
      `This endpoint is on another host (${new URL(url).origin}) than this app ` +
      `(${window.location.origin}). SAS Container Runtime does not send CORS headers, so the ` +
      'browser blocks the call. Route the container under the same host as this app (for ' +
      'example an ingress path on the Viya host), put a proxy that adds CORS headers in front ' +
      'of it, or use the desktop app.',
  };
}

// Desktop app: SCR calls go through the main process (no CORS there, and the
// renderer itself has no network access). Never with the Viya token.
const bridgeFetch = isElectronBridgeAvailable() ? createBridgeFetch('scr') : null;

async function scrFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await (bridgeFetch ?? fetch)(url, { ...init, credentials: 'omit', cache: 'no-store' });
  } catch (err) {
    const { reachable, reason } = reachableFromHere(url);
    const detail = err instanceof Error ? err.message : String(err);
    throw new ScrNetworkError(
      reachable
        ? `Could not reach ${url} (${detail}). Check that the container is running and the URL is right.`
        : reason ?? detail,
      url
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;

/** The `data.properties` of a named schema, in either OpenAPI 3 or Swagger 2 layout. */
function dataProperties(spec: Json, schemaName: string): Json | undefined {
  const schemas = asObject(asObject(spec.components)?.schemas) ?? asObject(spec.definitions);
  const schema = asObject(schemas?.[schemaName]);
  return asObject(asObject(asObject(schema?.properties)?.data)?.properties);
}

/** Batch schemas nest the row object inside the [rowId, row] pair. */
function batchRowDataProperties(spec: Json, schemaName: string, listName: string): Json | undefined {
  const schemas = asObject(asObject(spec.components)?.schemas);
  const pair = asObject(asObject(asObject(schemas?.[schemaName])?.properties)?.[listName]);
  const prefix = asObject(pair?.items)?.prefixItems;
  const row = Array.isArray(prefix) ? asObject(prefix[1]) : undefined;
  return asObject(asObject(asObject(row?.properties)?.data)?.properties);
}

function toVariables(properties: Json | undefined): ScrVariable[] {
  if (!properties) return [];
  return Object.entries(properties).map(([name, value]) => {
    const prop = asObject(value) ?? {};
    const rawType = String(prop.type ?? '').toLowerCase();
    const type: ScrVariable['type'] = rawType === 'string' ? 'string' : 'number';
    const length =
      typeof prop.maxLength === 'number'
        ? prop.maxLength
        : type === 'string' && typeof prop.length === 'number'
          ? prop.length
          : undefined;
    const description = typeof prop.description === 'string' && prop.description.trim()
      ? prop.description.trim()
      : undefined;
    const level = typeof prop.level === 'string' && prop.level ? prop.level : undefined;
    return { name, type, length, description, level };
  });
}

/** Reads an endpoint's signature document and what it says about the container. */
export function parseSignature(scoreUrl: string, spec: unknown): ScrEndpointInfo {
  const doc = asObject(spec);
  if (!doc) throw new Error('The endpoint did not return a signature document.');
  const { baseUrl, name } = splitScoreUrl(scoreUrl);
  const info = asObject(doc.info) ?? {};
  const title = String(info.title ?? '');
  const specVersion = String(doc.openapi ?? doc.swagger ?? '');
  const schemas = asObject(asObject(doc.components)?.schemas) ?? asObject(doc.definitions) ?? {};
  const paths = Object.keys(asObject(doc.paths) ?? {});

  let runtime: ScrRuntime = 'unknown';
  if (/^SAS Container Runtime/i.test(title) || schemas.SCRInput || schemas.MicroBatchInput) runtime = 'scr';
  else if (/^SAS Python Runtime/i.test(title)) runtime = 'python';
  else if (schemas.PCRInput) runtime = 'python-legacy';

  const mode: ScrMode = schemas.MicroBatchInput ? 'batch' : 'single';
  let inputs: ScrVariable[];
  let outputs: ScrVariable[];
  if (mode === 'batch') {
    inputs = toVariables(batchRowDataProperties(doc, 'MicroBatchInput', 'batchInputData'));
    outputs = toVariables(batchRowDataProperties(doc, 'MicroBatchOutput', 'batchOutputData'));
  } else if (runtime === 'scr') {
    inputs = toVariables(dataProperties(doc, 'SCRInput'));
    outputs = toVariables(dataProperties(doc, 'SCROutput'));
  } else {
    inputs = toVariables(dataProperties(doc, 'PCRInput'));
    outputs = toVariables(dataProperties(doc, 'PCROutput'));
  }

  const python = runtime === 'python' || runtime === 'python-legacy';
  return {
    scoreUrl,
    baseUrl,
    name,
    title,
    runtime,
    mode,
    specVersion,
    inputs,
    outputs,
    inputsRequired: python,
    hasRequestLog: python && paths.includes('/executions'),
    tls: scoreUrl.startsWith('https:'),
  };
}

/** GET {score}/apiMeta/api and read it. */
export async function inspectEndpoint(input: string): Promise<ScrEndpointInfo> {
  const scoreUrl = normalizeScoreUrl(input);
  const response = await scrFetch(`${scoreUrl}/apiMeta/api`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    throw new Error(
      `No signature at ${scoreUrl}/apiMeta/api (404). Check the last part of the URL: it must ` +
        'be the model name exactly as the container serves it (case matters for Python models).'
    );
  }
  if (!response.ok) {
    throw new Error(`The signature request failed: HTTP ${response.status} ${response.statusText}`.trim());
  }
  return parseSignature(scoreUrl, await readJson(response));
}

const probe = async (url: string): Promise<boolean | null> => {
  try {
    const response = await scrFetch(url);
    return response.ok;
  } catch {
    return null;
  }
};

export async function getHealth(info: ScrEndpointInfo): Promise<ScrHealth> {
  const [live, ready] = await Promise.all([
    probe(`${info.baseUrl}/internal/live`),
    probe(`${info.baseUrl}/internal/ready`),
  ]);
  return { live, ready };
}

/** Prometheus text from {base}/prometheus, or null when the image serves none. */
export async function getMetrics(info: ScrEndpointInfo): Promise<ScrMetrics | null> {
  let response: Response;
  try {
    response = await scrFetch(`${info.baseUrl}/prometheus`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const text = await response.text();
  if (!/^scr_/m.test(text)) return null;
  const read = (metric: string): number | null => {
    const match = text.match(new RegExp(`^${metric}(?:\\{[^}]*\\})?\\s+(\\S+)`, 'm'));
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  return {
    hits: read('scr_total_hit_count'),
    executions: read('scr_module_execution_count'),
    executionMsTotal: read('scr_module_execution_sum'),
    memoryUsedBytes: read('scr_memory_used_bytes'),
    busyWorkers: read('scr_busy_worker_thread_count'),
    threadPoolSize: read('scr_thread_pool_size'),
  };
}

function readMetadata(value: unknown, requestId?: unknown): ScrResponseMetadata {
  const meta = asObject(value) ?? {};
  const out: ScrResponseMetadata = { ...meta };
  if (typeof meta.module_id === 'string') out.moduleId = meta.module_id;
  if (typeof meta.step_id === 'string') out.stepId = meta.step_id;
  if (typeof meta.elapsed_nanos === 'number') out.elapsedNanos = meta.elapsed_nanos;
  if (typeof meta.timestamp === 'string') out.timestamp = meta.timestamp;
  if (typeof meta.transaction_id === 'string') out.transactionId = meta.transaction_id;
  if (typeof requestId === 'string') out.requestId = requestId;
  return out;
}

/** The message of an SCR or Python error body, or the HTTP status. */
function errorMessage(status: number, body: unknown): string {
  const obj = asObject(body);
  const message = obj?.errorMessage ?? obj?.message ?? obj?.error;
  const details = Array.isArray(obj?.details) ? (obj.details as unknown[]).filter(Boolean).join(' ') : '';
  if (typeof message === 'string' && message) return details ? `${message} ${details}` : message;
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 500);
  return `HTTP ${status}`;
}

/** Score one record. `data` holds input name → value. */
export async function scoreRecord(
  info: ScrEndpointInfo,
  data: Record<string, unknown>,
  transactionId?: string
): Promise<ScrScoreResult> {
  const body: Json = { data };
  if (transactionId) body.metadata = { transaction_id: transactionId };
  const started = performance.now();
  const response = await scrFetch(info.scoreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await readJson(response);
  const durationMs = performance.now() - started;
  const obj = asObject(raw) ?? {};
  const metadata = readMetadata(obj.metadata, obj.id);
  if (!response.ok) {
    return { ok: false, status: response.status, outputs: {}, metadata, raw, durationMs, error: errorMessage(response.status, raw) };
  }
  return { ok: true, status: response.status, outputs: asObject(obj.data) ?? {}, metadata, raw, durationMs };
}

/**
 * Score rows on a container in batch mode: one request, rows numbered from 1.
 * SCR fails the whole request when any row is wrong, so callers validate first.
 */
export async function scoreBatch(
  info: ScrEndpointInfo,
  rows: Record<string, unknown>[],
  batchId?: string
): Promise<ScrBatchResult> {
  const body: Json = { data: rows.map((row, index) => [index + 1, { data: row }]) };
  if (batchId) body.metadata = { batch_id: batchId };
  const started = performance.now();
  const response = await scrFetch(info.scoreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await readJson(response);
  const durationMs = performance.now() - started;
  const obj = asObject(raw) ?? {};
  const meta = asObject(obj.metadata);
  const elapsedNanos = typeof meta?.elapsed_nanos === 'number' ? meta.elapsed_nanos : undefined;
  if (!response.ok) {
    return { ok: false, status: response.status, rows: [], elapsedNanos, raw, durationMs, error: errorMessage(response.status, raw) };
  }
  const list = Array.isArray(obj.data) ? obj.data : [];
  const resultRows: ScrBatchRowResult[] = list.flatMap((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return [];
    const row = asObject(pair[1]) ?? {};
    return [{ rowId: Number(pair[0]), outputs: asObject(row.data) ?? {}, metadata: readMetadata(row.metadata) }];
  });
  return { ok: true, status: response.status, rows: resultRows, elapsedNanos, raw, durationMs };
}

/** Python images: the log of one request (successful or failed), as text. */
export async function getRequestLog(info: ScrEndpointInfo, requestId: string): Promise<string> {
  const response = await scrFetch(`${info.baseUrl}/query/${encodeURIComponent(requestId)}/log`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`No log for request ${requestId} (HTTP ${response.status}).`);
  }
  return text;
}

/**
 * Whether an error message says nothing: the Python images put the last line
 * of a traceback in errorMessage, which is often only the ^^^^ marker row.
 */
export function isUninformativeError(message: string | undefined): boolean {
  if (!message) return true;
  const rest = message.replace(/^\s*\d{3}\s+[A-Za-z ]+:\s*/, '');
  return !/[A-Za-z0-9]/.test(rest);
}

/**
 * The error a Python request log ends with: the last exception line of a
 * traceback ("ModuleNotFoundError: No module named 'sklearn'"), else the
 * last logged ERROR message that says something. Null when there is none.
 */
export function errorFromRequestLog(log: string): string | null {
  const lines = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt|Warning)\b.*:/.test(lines[i]) || /^[A-Za-z_][\w.]*Error$/.test(lines[i])) {
      return lines[i];
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/ - ERROR - (.*)$/);
    if (match && !isUninformativeError(match[1].replace(/^[^:]*:\s*/, ''))) return match[1];
  }
  return null;
}

/** What the step id in a response says the container holds. */
export function describeStep(stepId: string | undefined): string | null {
  if (!stepId) return null;
  const id = stepId.toLowerCase();
  if (id === 'score') return 'Model (step "score")';
  if (id === 'execute' || id.startsWith('execute_')) return 'Decision or rule set (step "execute")';
  if (id === 'scoremodel') return 'Python model (step "scoreModel")';
  return `Step "${stepId}"`;
}

export const RUNTIME_LABELS: Record<ScrRuntime, string> = {
  scr: 'SAS Container Runtime',
  python: 'SAS Python Runtime',
  'python-legacy': 'Python model image (Model Manager)',
  unknown: 'Unrecognised runtime',
};

/** SCR returns formatted SAS strings, e.g. "           0"; shown trimmed. */
export const displayValue = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const toStepParameter = (v: ScrVariable): StepParameter =>
  v.type === 'string' ? { name: v.name, type: 'string', size: v.length } : { name: v.name, type: 'decimal' };

/**
 * The endpoint's signature in the shape the UI Builder and runner use for a
 * MAS step. The id is the step id a score answered with when known, "score"
 * otherwise; it is a label only, SCR is not called by step.
 */
export function scrStep(info: ScrEndpointInfo, stepId = 'score'): Step {
  return {
    id: stepId,
    moduleId: info.name,
    description: info.title,
    inputs: info.inputs.map(toStepParameter),
    outputs: info.outputs.map(toStepParameter),
    links: [],
    version: 1,
  };
}

/**
 * One record scored for a UI App: the outputs trimmed for display, or an
 * error message. A Python image's own message is often only the last line of
 * a traceback ("^^^^"); then the request log is read for the real error.
 */
export async function scoreForApp(
  info: ScrEndpointInfo,
  data: Record<string, unknown>
): Promise<{ outputs: Record<string, unknown>; elapsedMs: number; stepId?: string }> {
  const result = await scoreRecord(info, data);
  if (result.ok) {
    const outputs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(result.outputs)) outputs[name] = displayValue(value);
    return { outputs, elapsedMs: result.durationMs, stepId: result.metadata.stepId };
  }
  let message = result.error ?? `HTTP ${result.status}`;
  if (info.hasRequestLog && result.metadata.requestId && isUninformativeError(message)) {
    try {
      const fromLog = errorFromRequestLog(await getRequestLog(info, result.metadata.requestId));
      if (fromLog) message = `${fromLog} (from the request log of ${result.metadata.requestId})`;
    } catch {
      // The log could not be read; the endpoint's own message stays.
    }
  }
  throw new Error(message);
}
