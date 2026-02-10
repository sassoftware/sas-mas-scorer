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

/**
 * Get the SAS Viya server URL
 * Priority:
 * 1. Runtime config (window.SAS_CONFIG.SAS_VIYA_URL) if set and non-empty
 * 2. Build-time env variable (VITE_SAS_URL) if set
 * 3. Default to window.location.origin
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

  // Default to current origin
  return window.location.origin;
};
