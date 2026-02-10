// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, useContext, ReactNode } from 'react';

/**
 * No-auth implementation for job definition builds.
 * Assumes user is already authenticated via SAS Viya session cookies.
 * API calls work because the client uses withCredentials: true.
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

interface SasAuthProviderProps {
  children: ReactNode;
}

export const SasAuthProvider: React.FC<SasAuthProviderProps> = ({ children }) => {
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
