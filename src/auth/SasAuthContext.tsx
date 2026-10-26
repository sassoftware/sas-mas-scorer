// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { CookieAuthenticationCredential } from '@sassoftware/sas-auth-browser';
import { clearCsrfToken } from '../api/client';
import { getSasViyaUrl } from '../config';
import { isCookieSessionValid, signInWithCookiePopup } from './cookieSignIn';
import { markSessionActive } from './sessionExpiry';
import { useSessionExpiryPrompt } from './useSessionExpiryPrompt';

interface SasAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const SasAuthContext = createContext<SasAuthContextType | null>(null);

// Create singleton auth instance
let authInstance: CookieAuthenticationCredential | null = null;

const getAuthInstance = (): CookieAuthenticationCredential => {
  if (!authInstance) {
    authInstance = new CookieAuthenticationCredential({
      url: getSasViyaUrl(),
    });
  }
  return authInstance;
};

interface SasAuthProviderProps {
  children: ReactNode;
}

export const SasAuthProvider: React.FC<SasAuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async (): Promise<boolean> => {
    const auth = getAuthInstance();
    try {
      await auth.checkAuthenticated();
      setIsAuthenticated(true);
      setError(null);
      return true;
    } catch {
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const login = useCallback(async (): Promise<void> => {
    const auth = getAuthInstance();
    setIsLoading(true);
    setError(null);

    try {
      // First check if already authenticated. The check caches its answer;
      // drop it so a session that has since ended is not read as signed in.
      auth.invalidateCache();
      try {
        await auth.checkAuthenticated();
        setIsAuthenticated(true);
        markSessionActive();
        return;
      } catch {
        // Not authenticated, proceed with login
      }

      // Open login popup
      await auth.loginPopup();
      setIsAuthenticated(true);
      markSessionActive();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      setIsAuthenticated(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const auth = getAuthInstance();
    setIsLoading(true);

    try {
      await auth.logout();
      setIsAuthenticated(false);
      setError(null);
      // Clear CSRF token and invalidate cache after logout
      clearCsrfToken();
      auth.invalidateCache();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      await checkAuth();
      setIsLoading(false);
    };
    initAuth();
  }, [checkAuth]);

  // A request found the session has ended (SAS Viya redirected it to
  // SASLogon): one prompt to sign in again, then the waiting requests retry.
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;
  const sessionPrompt = useSessionExpiryPrompt({
    canPrompt: () => isAuthenticatedRef.current,
    confirmSession: () => isCookieSessionValid(getAuthInstance()),
    signIn: async () => {
      await signInWithCookiePopup(getAuthInstance());
      // A new session comes with a new CSRF token.
      clearCsrfToken();
      setIsAuthenticated(true);
      setError(null);
    },
    // Closed without signing in: show the signed-out state (header Login
    // button, the views' sign-in prompts) instead of a stale "Connected".
    onDismiss: () => setIsAuthenticated(false),
  });

  const value: SasAuthContextType = {
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    checkAuth,
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

// Export the auth instance getter for use in API client
export { getAuthInstance };

// Re-export config function for convenience
export { getSasViyaUrl } from '../config';
