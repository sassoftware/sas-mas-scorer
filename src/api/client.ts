// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '../types';
import { getSasViyaUrl } from '../config';

// CSRF Token management - token is extracted from failed request responses
let csrfToken: string | null = null;

const clearCsrfToken = (): void => {
  csrfToken = null;
};

// Create the axios instance with cookie-based authentication
const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: `${getSasViyaUrl()}/microanalyticScore`,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
    // Enable cookies for cross-origin requests
    withCredentials: true,
  });

  // Request interceptor to add CSRF token for mutating requests (if we have one cached)
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const method = config.method?.toUpperCase();

      // Add CSRF token for POST, PUT, DELETE, PATCH requests if we have one
      if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && csrfToken) {
        config.headers['X-CSRF-TOKEN'] = csrfToken;
      }

      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor for error handling and CSRF retry
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiError>) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _csrfRetry?: boolean };

      // Check if this is a CSRF error (403) and we haven't retried yet
      if (
        error.response?.status === 403 &&
        !originalRequest._csrfRetry
      ) {
        // Extract CSRF token from the failed response headers
        const newToken = error.response.headers['x-csrf-token'];

        if (newToken && typeof newToken === 'string') {
          // Cache the token for future requests
          csrfToken = newToken;
          originalRequest._csrfRetry = true;

          // Retry the request with the new token
          originalRequest.headers['X-CSRF-TOKEN'] = newToken;
          return client(originalRequest);
        }
      }

      if (error.response?.status === 401) {
        // Authentication error - will be handled by auth context
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

  return client;
};

// Export a singleton instance
export const apiClient = createApiClient();

// Create a generic SAS Viya API client (not bound to /microanalyticScore)
const createGenericApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: getSasViyaUrl(),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
    withCredentials: true,
  });

  // Request interceptor to add CSRF token
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const method = config.method?.toUpperCase();
      if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && csrfToken) {
        config.headers['X-CSRF-TOKEN'] = csrfToken;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiError>) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _csrfRetry?: boolean };

      if (error.response?.status === 403 && !originalRequest._csrfRetry) {
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
