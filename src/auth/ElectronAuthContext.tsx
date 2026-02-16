// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron-specific auth context that uses IPC to communicate with the main process.
 * Implements the same SasAuthContextType interface as SasAuthContext.tsx so all
 * downstream components work unchanged.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { clearCsrfToken } from '../api/client';

interface SasAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const SasAuthContext = createContext<SasAuthContextType | null>(null);

interface SasAuthProviderProps {
  children: ReactNode;
}

export const SasAuthProvider: React.FC<SasAuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) return false;
    try {
      const authed = await window.electronAPI.isAuthenticated();
      setIsAuthenticated(authed);
      setError(null);
      return authed;
    } catch {
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const login = useCallback(async (): Promise<void> => {
    if (!window.electronAPI) {
      setError('Not running in Electron');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if already authenticated
      const alreadyAuthed = await window.electronAPI.isAuthenticated();
      if (alreadyAuthed) {
        setIsAuthenticated(true);
        return;
      }

      // Start OAuth login flow (opens auth window in main process)
      await window.electronAPI.startLogin();
      setIsAuthenticated(true);
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
    if (!window.electronAPI) return;

    setIsLoading(true);
    try {
      await window.electronAPI.logout();
      setIsAuthenticated(false);
      setError(null);
      clearCsrfToken();
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
