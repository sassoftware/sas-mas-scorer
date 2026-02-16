// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron main process — window management, IPC handlers, OAuth flow.
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import {
  generatePkce,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  PkceChallenge,
} from './auth';
import {
  getTokens,
  setTokens,
  clearTokens,
  getConnection,
  getAllConnections,
  addConnection,
  updateConnection,
  deleteConnection,
  setActiveConnection,
  getActiveConnectionId,
  SavedConnection,
} from './tokenStore';

let mainWindow: BrowserWindow | null = null;

// --- Token refresh deduplication ---
let refreshInFlight: Promise<string | null> | null = null;

// --- SSL configuration ---

function applySslConfig(): void {
  const connection = getConnection();
  if (connection?.insecureSsl) {
    session.defaultSession.setCertificateVerifyProc((_request, callback) => {
      callback(0); // Accept all certificates
    });
  } else {
    // Reset to default certificate verification
    session.defaultSession.setCertificateVerifyProc(null);
  }
}

// --- Window creation ---

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'SAS MAS Scorer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Disable same-origin policy so renderer can call Viya APIs cross-origin.
      // Safe for a desktop app that only loads our own code.
      webSecurity: false,
    },
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, load from built dist files
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC Handlers ---

function registerIpcHandlers(): void {
  // --- Connection Management ---

  ipcMain.handle('conn:getAll', () => {
    return getAllConnections();
  });

  ipcMain.handle('conn:getActive', () => {
    return getConnection();
  });

  ipcMain.handle('conn:add', (_event, conn: Omit<SavedConnection, 'id'>) => {
    const saved = addConnection(conn);
    return saved;
  });

  ipcMain.handle('conn:update', (_event, conn: SavedConnection) => {
    updateConnection(conn);
    // Re-apply SSL if this is the active connection
    if (conn.id === getActiveConnectionId()) {
      applySslConfig();
    }
  });

  ipcMain.handle('conn:delete', (_event, id: string) => {
    deleteConnection(id);
  });

  ipcMain.handle('conn:setActive', (_event, id: string) => {
    setActiveConnection(id);
    applySslConfig();
    refreshInFlight = null;
  });

  // Backward-compat alias used by client.ts
  ipcMain.handle('auth:getViyaUrl', () => {
    return getConnection()?.viyaUrl ?? null;
  });

  // --- Auth Status ---

  ipcMain.handle('auth:isAuthenticated', () => {
    const tokens = getTokens();
    return tokens !== null && tokens.expiresAt > Date.now();
  });

  // --- Get Access Token (with auto-refresh) ---

  ipcMain.handle('auth:getAccessToken', async () => {
    const tokens = getTokens();
    if (!tokens) return null;

    // If token is still valid (with 60-second buffer), return it
    if (tokens.expiresAt - 60_000 > Date.now()) {
      return tokens.accessToken;
    }

    // Token expired or about to expire — refresh it
    // Deduplicate concurrent refresh requests
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async (): Promise<string | null> => {
      const connection = getConnection();
      if (!connection) return null;

      try {
        const newTokens = await refreshAccessToken(
          connection.viyaUrl,
          connection.clientId,
          connection.clientSecret,
          tokens.refreshToken,
          connection.insecureSsl
        );

        const expiresAt = Date.now() + newTokens.expires_in * 1000;
        setTokens({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt,
        });

        return newTokens.access_token;
      } catch {
        // Refresh failed — clear tokens, user needs to re-login
        clearTokens();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  });

  // --- Login ---

  ipcMain.handle('auth:startLogin', async () => {
    const connection = getConnection();
    if (!connection) {
      throw new Error('No connection configured. Please set up a connection first.');
    }

    const pkce: PkceChallenge = generatePkce();
    const authUrl = buildAuthorizationUrl(
      connection.viyaUrl,
      connection.clientId,
      pkce.codeChallenge
    );

    return new Promise<{ success: boolean }>((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 800,
        height: 700,
        parent: mainWindow ?? undefined,
        modal: true,
        title: 'SAS Viya Login',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // Apply SSL bypass for the auth window if needed
      if (connection.insecureSsl) {
        authWindow.webContents.session.setCertificateVerifyProc((_request, callback) => {
          callback(0);
        });
      }

      let completed = false;

      const handleUrl = async (url: string): Promise<boolean> => {
        if (completed) return false;

        try {
          const parsed = new URL(url);
          const code = parsed.searchParams.get('code');

          if (code) {
            completed = true;
            authWindow.close();

            try {
              const tokens = await exchangeCodeForTokens(
                connection.viyaUrl,
                connection.clientId,
                connection.clientSecret,
                code,
                pkce.codeVerifier,
                connection.insecureSsl
              );

              const expiresAt = Date.now() + tokens.expires_in * 1000;
              setTokens({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt,
              });

              resolve({ success: true });
            } catch (err) {
              reject(err);
            }
            return true;
          }
        } catch {
          // URL parsing failed — not a redirect we care about
        }
        return false;
      };

      // Intercept redirects to capture the authorization code
      authWindow.webContents.on('will-redirect', (event, url) => {
        handleUrl(url).then((handled) => {
          if (handled) {
            event.preventDefault();
          }
        });
      });

      authWindow.webContents.on('will-navigate', (_event, url) => {
        handleUrl(url);
      });

      // Also check the URL after each page finishes loading,
      // in case the code appears in the final URL without a redirect event
      authWindow.webContents.on('did-navigate', (_event, url) => {
        handleUrl(url);
      });

      authWindow.on('closed', () => {
        if (!completed) {
          reject(new Error('Login cancelled — window was closed.'));
        }
      });

      authWindow.loadURL(authUrl);
    });
  });

  // --- Logout ---

  ipcMain.handle('auth:logout', () => {
    clearTokens();
  });
}

// --- App lifecycle ---

app.whenReady().then(() => {
  registerIpcHandlers();
  applySslConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
