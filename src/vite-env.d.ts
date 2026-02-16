// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build mode constant injected by Vite
declare const __BUILD_MODE__: 'standard' | 'jobdef' | 'electron';

// Electron IPC bridge (exposed via preload script)
interface ConnectionSettings {
  viyaUrl: string;
  clientId: string;
  clientSecret: string;
  insecureSsl: boolean;
}

interface SavedConnection extends ConnectionSettings {
  id: string;
  name: string;
}

interface ElectronAPI {
  // Connection management
  getAllConnections: () => Promise<SavedConnection[]>;
  getActiveConnection: () => Promise<SavedConnection | null>;
  addConnection: (conn: Omit<SavedConnection, 'id'>) => Promise<SavedConnection>;
  updateConnection: (conn: SavedConnection) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setActiveConnection: (id: string) => Promise<void>;

  // Backward-compat alias
  getConnection: () => Promise<SavedConnection | null>;

  // Auth flow
  startLogin: () => Promise<{ success: boolean }>;
  logout: () => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  getViyaUrl: () => Promise<string | null>;
  isElectron: true;
}

interface Window {
  electronAPI?: ElectronAPI;
}
