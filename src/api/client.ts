// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '../types';
import { getSasViyaUrl } from '../config';

const isElectron = !!window.electronAPI;

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
      // Electron mode: dynamic baseURL + Bearer token
      if (isElectron && window.electronAPI) {
        const viyaUrl = await window.electronAPI.getViyaUrl();
        if (viyaUrl) {
          config.baseURL = basePath ? `${viyaUrl}${basePath}` : viyaUrl;
        }

        const token = await window.electronAPI.getAccessToken();
        if (token) {
          config.headers['Authorization'] = `Bearer ${token}`;
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
    (response) => response,
    async (error: AxiosError<ApiError>) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _csrfRetry?: boolean };

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

      if (error.response?.status === 401) {
        return Promise.reject(new Error('Authentication required. Please log in.'));
      }
      if (error.response?.data) {
        const apiError = error.response.data;
        const errorMessage = apiError.message ||
          apiError.details?.join(', ') ||
          'An unknown error occurred';
        return Promise.reject(new Error(errorMessage));
      }
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
