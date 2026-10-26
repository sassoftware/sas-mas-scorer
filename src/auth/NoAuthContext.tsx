// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, useContext, ReactNode } from 'react';
import { CookieAuthenticationCredential } from '@sassoftware/sas-auth-browser';
import { clearCsrfToken } from '../api/client';
import { getSasViyaUrl } from '../config';
import { isCookieSessionValid, signInWithCookiePopup } from './cookieSignIn';
import { useSessionExpiryPrompt } from './useSessionExpiryPrompt';

/**
 * No-auth implementation for job definition builds.
 * Assumes user is already authenticated via SAS Viya session cookies.
 * API calls work because the client uses withCredentials: true.
 *
 * The session can still end while the page is open (SAS Job Execution / VA
 * session timeout). The API client notices the redirect to SASLogon, and this
 * provider then offers to sign in again in a popup — the page is same-origin
 * with SAS Viya, so the popup's new session cookie applies here — or to
 * reload the page.
 */

interface SasAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const SasAuthContext = createContext<SasAuthContextType | null>(null);

// Only used to sign in again after the session has ended.
let authInstance: CookieAuthenticationCredential | null = null;
const getCookieCredential = (): CookieAuthenticationCredential => {
  if (!authInstance) {
    authInstance = new CookieAuthenticationCredential({ url: getSasViyaUrl() });
  }
  return authInstance;
};

interface SasAuthProviderProps {
  children: ReactNode;
}

export const SasAuthProvider: React.FC<SasAuthProviderProps> = ({ children }) => {
  const sessionPrompt = useSessionExpiryPrompt({
    canPrompt: () => true,
    confirmSession: () => isCookieSessionValid(getCookieCredential()),
    signIn: async () => {
      await signInWithCookiePopup(getCookieCredential());
      // A new session comes with a new CSRF token.
      clearCsrfToken();
    },
    onReload: () => window.location.reload(),
  });

  // In no-auth mode, we always assume authenticated (session cookies handle auth)
  const value: SasAuthContextType = {
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: async () => {
      // No-op: authentication is handled by SAS Viya session
    },
    logout: async () => {
      // No-op: logout should be done through SAS Viya directly
    },
    checkAuth: async () => {
      // Always return true - session cookies will handle actual auth
      return true;
    },
  };

  return (
    <SasAuthContext.Provider value={value}>
      {children}
      {sessionPrompt}
    </SasAuthContext.Provider>
  );
};

export const useSasAuth = (): SasAuthContextType => {
  const context = useContext(SasAuthContext);
  if (!context) {
    throw new Error('useSasAuth must be used within a SasAuthProvider');
  }
  return context;
};

// Stub for getAuthInstance - not used in no-auth mode but needed for interface compatibility
export const getAuthInstance = (): null => null;

// Re-export config function for convenience
export { getSasViyaUrl } from '../config';
