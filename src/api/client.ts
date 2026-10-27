// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '../types';
import { getSasViyaUrl } from '../config';
import { markSessionActive, requestSessionRenewal, SESSION_EXPIRED_MESSAGE } from '../auth/sessionExpiry';
import { FailureDetails, recordFailure, ViyaApiError } from '../utils/apiErrors';

const isElectron = !!window.electronAPI;

const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please log in.';

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _csrfRetry?: boolean;
  _authRetry?: boolean;
  /** Set on the retry after the session was renewed (quietly or by signing in). */
  _sessionRetry?: boolean;
  /** Set once the user was asked to sign in for this request; no further prompt. */
  _sessionPrompted?: boolean;
};

const SASLOGON_RE = /\/SASLogon\//i;

const requestedUrl = (config: InternalAxiosRequestConfig): string => `${config.baseURL ?? ''}${config.url ?? ''}`;

/** Method and path (no query string) of a request, for the error details. */
const requestDetails = (config: InternalAxiosRequestConfig | undefined): FailureDetails => {
  if (!config) return {};
  let path: string | undefined;
  try {
    path = new URL(requestedUrl(config), window.location.href).pathname;
  } catch {
    path = config.url?.split('?')[0];
  }
  return { method: config.method?.toUpperCase(), path };
};

/** Reject with a structured error, and keep it for the alerts' Copy details action. */
const failure = (message: string, details: FailureDetails): ViyaApiError => {
  recordFailure(message, details);
  return new ViyaApiError(message, details);
};

/**
 * An ended cookie session (web and jobdef builds) does not answer 401: SAS
 * Viya redirects the request to /SASLogon/login, the browser follows the
 * redirect, and the client gets HTTP 200 with the logon page or its JSON info
 * document instead of the resource. Recognised by the final URL, or by an HTML
 * page where JSON was asked for.
 */
const isSasLogonResponse = (response: AxiosResponse): boolean => {
  const finalUrl = (response.request as { responseURL?: string } | undefined)?.responseURL;
  if (finalUrl && SASLOGON_RE.test(finalUrl) && !SASLOGON_RE.test(requestedUrl(response.config))) {
    return true;
  }
  const responseType = response.config.responseType;
  const accept = String(response.config.headers?.['Accept'] ?? '');
  const contentType = String(response.headers?.['content-type'] ?? '');
  return (!responseType || responseType === 'json') && /json/i.test(accept) && /text\/html/i.test(contentType);
};

/**
 * A request made with responseType 'text' gets its error body as a string;
 * read a Viya error document out of it like a parsed one.
 */
const parseErrorBody = (data: unknown): ApiError | string | undefined => {
  if (typeof data !== 'string') return (data ?? undefined) as ApiError | undefined;
  if (!data.trim().startsWith('{')) return data;
  try {
    return JSON.parse(data) as ApiError;
  } catch {
    return data;
  }
};

/**
 * The session has ended: ask the auth provider to sign the user in again (one
 * prompt for all requests in flight), then retry this request once. Without a
 * renewal the request fails with a message that says what happened.
 */
const retryAfterSignIn = async (
  client: AxiosInstance,
  config: RetryableRequestConfig,
  status: number | undefined
): Promise<AxiosResponse> => {
  const details = { ...requestDetails(config), status };
  // First time: the session may only need a quiet check or token refresh.
  // Turned away again after that: ask the user to sign in, once.
  if (config._sessionPrompted) {
    throw failure(AUTH_REQUIRED_MESSAGE, details);
  }
  const force = !!config._sessionRetry;
  const renewal = await requestSessionRenewal({ force });
  if (renewal === 'renewed') {
    config._sessionRetry = true;
    if (force) config._sessionPrompted = true;
    return client(config);
  }
  throw failure(renewal === 'dismissed' ? SESSION_EXPIRED_MESSAGE : AUTH_REQUIRED_MESSAGE, details);
};

// CSRF Token management - token is extracted from failed request responses
let csrfToken: string | null = null;

const clearCsrfToken = (): void => {
  csrfToken = null;
};

/**
 * Shared request interceptor that adds:
 * - Bearer token (Electron mode) or cookies (browser mode)
 * - CSRF token for mutating requests
 * - Dynamic baseURL (Electron mode)
 */
const addAuthInterceptor = (client: AxiosInstance, basePath: string): void => {
  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      // Electron mode: dynamic baseURL + Bearer token. The two IPC reads are
      // independent, so they run concurrently — one main-process round trip
      // per request instead of two in series.
      if (isElectron && window.electronAPI) {
        const [viyaUrl, token] = await Promise.all([
          window.electronAPI.getViyaUrl(),
          window.electronAPI.getAccessToken(),
        ]);
        if (viyaUrl) {
          config.baseURL = basePath ? `${viyaUrl}${basePath}` : viyaUrl;
        }

        let bearer = token;
        // No token although a connection is configured: the session ended
        // (the refresh token was rejected and the main process cleared the
        // tokens). Ask for a new sign-in before sending a request that can
        // only fail; when no prompt applies, send it as before.
        if (!bearer && viyaUrl) {
          const renewal = await requestSessionRenewal();
          if (renewal === 'renewed') {
            bearer = await window.electronAPI.getAccessToken();
          } else if (renewal === 'dismissed') {
            throw failure(SESSION_EXPIRED_MESSAGE, requestDetails(config));
          }
        }

        if (bearer) {
          config.headers['Authorization'] = `Bearer ${bearer}`;
        }
      }

      // CSRF token for mutating requests (needed in both modes)
      const method = config.method?.toUpperCase();
      if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && csrfToken) {
        config.headers['X-CSRF-TOKEN'] = csrfToken;
      }

      return config;
    },
    (error) => Promise.reject(error)
  );
};

/**
 * Shared response interceptor for CSRF retry and error handling.
 */
const addErrorInterceptor = (client: AxiosInstance): void => {
  client.interceptors.response.use(
    (response) => {
      if (isSasLogonResponse(response)) {
        return retryAfterSignIn(client, response.config as RetryableRequestConfig, response.status);
      }
      markSessionActive();
      return response;
    },
    async (error: AxiosError<ApiError>) => {
      // Already structured (thrown by the request interceptor): pass it on.
      if (error instanceof ViyaApiError) {
        return Promise.reject(error);
      }
      const originalRequest = error.config as RetryableRequestConfig;

      // The first cookie-authenticated call to a service the browser session
      // has not used yet can come back as "Authentication success, retry
      // original request." once the service has set up its session. Retry it
      // once; seen in jobdef mode on the first POST to /scoreDefinitions.
      if (
        originalRequest &&
        !originalRequest._authRetry &&
        /retry original request/i.test(error.response?.data?.message ?? '')
      ) {
        originalRequest._authRetry = true;
        return client(originalRequest);
      }

      // CSRF error (403) — extract token and retry once
      if (
        error.response?.status === 403 &&
        !originalRequest._csrfRetry
      ) {
        const newToken = error.response.headers['x-csrf-token'];

        if (newToken && typeof newToken === 'string') {
          csrfToken = newToken;
          originalRequest._csrfRetry = true;
          originalRequest.headers['X-CSRF-TOKEN'] = newToken;
          return client(originalRequest);
        }
      }

      // The bearer token was rejected (Electron), or a cookie session ended
      // on a service that answers 401 instead of redirecting.
      if (error.response?.status === 401 && originalRequest) {
        return retryAfterSignIn(client, originalRequest, 401);
      }

      // Cancelled requests pass through untouched: callers test
      // axios.isCancel(err) on them.
      if (axios.isCancel(error)) {
        return Promise.reject(error);
      }

      const status = error.response?.status;
      const body = parseErrorBody(error.response?.data);
      const isErrorBody = !!body && typeof body === 'object';
      // Viya error bodies carry the request path in details ("path: /…");
      // prefer it to the client's view of the URL.
      const serverPath = isErrorBody
        ? body.details?.find((d) => typeof d === 'string' && d.startsWith('path: '))?.slice('path: '.length)
        : undefined;
      const details: FailureDetails = {
        ...requestDetails(originalRequest),
        ...(serverPath ? { path: serverPath } : {}),
        status,
        errorCode: isErrorBody && typeof body.errorCode === 'number' ? body.errorCode : undefined,
        remediation: isErrorBody && typeof body.remediation === 'string' && body.remediation ? body.remediation : undefined,
      };

      if (status === 403) {
        return Promise.reject(failure('Access denied (403). This operation requires SAS Administrator privileges.', details));
      }
      if (status === 502 || status === 503 || status === 504) {
        return Promise.reject(failure(`SAS Viya service is temporarily unavailable (HTTP ${status}). Please retry in a moment.`, details));
      }
      if (body) {
        const errorMessage = (isErrorBody && (body.message || body.details?.join(', '))) ||
          'An unknown error occurred';
        return Promise.reject(failure(errorMessage, details));
      }
      // No response (network failure, timeout): the axios error goes on as
      // before, so callers can still read its code; it is recorded for
      // Copy details.
      recordFailure(error.message, { ...details, code: error.code });
      return Promise.reject(error);
    }
  );
};

// Create the MAS API client (bound to /microanalyticScore)
const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    // In browser mode, set baseURL at creation time; in Electron, interceptor sets it per-request
    baseURL: isElectron ? '' : `${getSasViyaUrl()}/microanalyticScore`,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
    // Cookie auth for browser mode only
    withCredentials: !isElectron,
  });

  addAuthInterceptor(client, '/microanalyticScore');
  addErrorInterceptor(client);

  return client;
};

// Export a singleton instance
export const apiClient = createApiClient();

// Create a generic SAS Viya API client (not bound to /microanalyticScore)
const createGenericApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: isElectron ? '' : getSasViyaUrl(),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
    withCredentials: !isElectron,
  });

  addAuthInterceptor(client, '');
  addErrorInterceptor(client);

  return client;
};

// Export generic SAS Viya client
export const sasViyaClient = createGenericApiClient();

// Export function to clear CSRF token (useful on logout)
export { clearCsrfToken };

// Export factory for custom configurations
export { createApiClient };

// Re-export config function for convenience
export { getSasViyaUrl } from '../config';

// SAS-specific content types
export const SAS_CONTENT_TYPES = {
  MODULE: 'application/vnd.sas.microanalytic.module+json',
  MODULE_DEFINITION: 'application/vnd.sas.microanalytic.module.definition+json',
  MODULE_SOURCE: 'application/vnd.sas.microanalytic.module.source+json',
  STEP: 'application/vnd.sas.microanalytic.module.step+json',
  STEP_INPUT: 'application/vnd.sas.microanalytic.module.step.input+json',
  STEP_OUTPUT: 'application/vnd.sas.microanalytic.module.step.output+json',
  SUBMODULE: 'application/vnd.sas.microanalytic.submodule+json',
  JOB: 'application/vnd.sas.microanalytic.job+json',
  COLLECTION: 'application/vnd.sas.collection+json',
  ERROR: 'application/vnd.sas.error+json',
};
