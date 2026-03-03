// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Configuration helper
// Reads runtime config from window.SAS_CONFIG (set in public/config.js)

interface SasConfig {
  SAS_VIYA_URL?: string;
}

declare global {
  interface Window {
    SAS_CONFIG?: SasConfig;
  }
}

// Cached Viya URL from Electron connection details
let cachedViyaUrl: string | null = null;

/**
 * Initialize the cached Viya URL from Electron connection details.
 * Call this early during app startup so getSasViyaUrl() can return it synchronously.
 */
export const initViyaUrl = async (): Promise<void> => {
  if (window.electronAPI) {
    cachedViyaUrl = await window.electronAPI.getViyaUrl() ?? null;
  }
};

/**
 * Check whether the origin is a local/dev URL (localhost or file://) where
 * window.location.origin would not be a valid Viya server URL.
 */
const isLocalOrigin = (): boolean => {
  const origin = window.location.origin;
  return origin === 'null' || // file:// protocol
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1');
};

/**
 * Get the SAS Viya server URL
 * Priority:
 * 1. Runtime config (window.SAS_CONFIG.SAS_VIYA_URL) if set and non-empty
 * 2. Build-time env variable (VITE_SAS_URL) if set
 * 3. Cached Electron connection URL (when origin is localhost / file://)
 * 4. Default to window.location.origin
 */
export const getSasViyaUrl = (): string => {
  // Check runtime config first
  const runtimeUrl = window.SAS_CONFIG?.SAS_VIYA_URL;
  if (runtimeUrl && runtimeUrl.trim() !== '') {
    return runtimeUrl.trim();
  }

  // Check build-time env variable
  const envUrl = import.meta.env.VITE_SAS_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim();
  }

  // In Electron (or any local origin), use the cached connection URL
  if (isLocalOrigin() && cachedViyaUrl) {
    return cachedViyaUrl;
  }

  // Default to current origin
  return window.location.origin;
};
