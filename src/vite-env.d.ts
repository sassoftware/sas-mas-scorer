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

// App version from package.json, injected by Vite
declare const __APP_VERSION__: string;

// Electron IPC bridge (exposed via preload script)
interface ConnectionSettings {
  viyaUrl: string;
  clientId: string;
  insecureSsl: boolean;
}

/** A saved connection as the renderer sees it: the client secret stays in the main process. */
interface SavedConnection extends ConnectionSettings {
  id: string;
  name: string;
  /** Environment color (hex) applied to the app chrome while this connection is active */
  color?: string;
  /** Whether a client secret is saved for this connection (the secret itself is never sent). */
  hasClientSecret: boolean;
}

/** Connection fields sent to the main process when adding or editing one. */
interface ConnectionInput extends ConnectionSettings {
  name: string;
  color?: string;
  /** On edit: undefined keeps the saved secret, '' removes it, a value replaces it. */
  clientSecret?: string;
}

interface ElectronAPI {
  // Connection management
  getAllConnections: () => Promise<SavedConnection[]>;
  getActiveConnection: () => Promise<SavedConnection | null>;
  addConnection: (conn: ConnectionInput) => Promise<SavedConnection>;
  updateConnection: (conn: ConnectionInput & { id: string }) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setActiveConnection: (id: string) => Promise<void>;

  // Backward-compat alias
  getConnection: () => Promise<SavedConnection | null>;

  // Auth flow
  startLogin: () => Promise<{ success: boolean }>;
  logout: () => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
  getViyaUrl: () => Promise<string | null>;
  /** HTTP bridge (electron/httpBridge.ts): 'viya' requests get the access token in the main process. */
  httpRequest: (req: ElectronBridgeRequest) => Promise<ElectronBridgeResponse>;
  httpAbort: (id: string) => Promise<void>;
  isElectron: true;
}

interface ElectronBridgeRequest {
  id: string;
  kind: 'viya' | 'scr';
  url: string;
  method: string;
  headers: [string, string][];
  body?: Uint8Array;
}

interface ElectronBridgeResponse {
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  body?: Uint8Array;
  url?: string;
  error?: { kind: 'abort' | 'network' | 'refused'; message: string };
}

interface Window {
  electronAPI?: ElectronAPI;
}
