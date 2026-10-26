// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron main process — window management, IPC handlers, OAuth flow.
 */

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import {
  generatePkce,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  PkceChallenge,
  TokenEndpointError,
} from './auth';
import {
  getTokens,
  getTokensFor,
  setTokens,
  setTokensFor,
  clearTokens,
  clearTokensFor,
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

// --- Token refresh ---

// One refresh at a time per connection: concurrent requests that all find the
// access token expired share the same refresh call.
let refreshInFlight: { connectionId: string; promise: Promise<string | null> } | null = null;

/**
 * Renew the active connection's access token with its stored refresh token.
 * Resolves to the new access token, or null when there is nothing to refresh
 * with or the refresh failed.
 *
 * Only a rejected grant (HTTP 400/401: the refresh token has expired or was
 * revoked) clears the stored tokens. A network error or an unavailable server
 * (VPN not up yet, Viya restarting) keeps them, so a later attempt can still
 * renew the session without the login window.
 */
function refreshSession(): Promise<string | null> {
  const connection = getConnection();
  const tokens = getTokens();
  if (!connection || !tokens?.refreshToken) return Promise.resolve(null);

  if (refreshInFlight && refreshInFlight.connectionId === connection.id) {
    return refreshInFlight.promise;
  }

  const connectionId = connection.id;
  const entry: NonNullable<typeof refreshInFlight> = { connectionId, promise: Promise.resolve(null) };
  entry.promise = (async (): Promise<string | null> => {
    try {
      const newTokens = await refreshAccessToken(
        connection.viyaUrl,
        connection.clientId,
        connection.clientSecret,
        tokens.refreshToken,
        connection.insecureSsl
      );

      // The user logged out (or logged in again) while the refresh was out:
      // keep what is stored now rather than bringing the old session back.
      const stored = getTokensFor(connectionId);
      if (!stored || stored.refreshToken !== tokens.refreshToken) {
        return stored?.accessToken ?? null;
      }

      // Written to the connection the refresh was started for, even if the
      // user switched connection while it was out.
      setTokensFor(connectionId, {
        accessToken: newTokens.access_token,
        // SASLogon may answer without rotating the refresh token.
        refreshToken: newTokens.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + newTokens.expires_in * 1000,
      });

      return newTokens.access_token;
    } catch (err) {
      if (
        err instanceof TokenEndpointError &&
        (err.status === 400 || err.status === 401) &&
        getTokensFor(connectionId)?.refreshToken === tokens.refreshToken
      ) {
        // The refresh token is no longer accepted; the user has to log in.
        clearTokensFor(connectionId);
      }
      return null;
    } finally {
      if (refreshInFlight === entry) refreshInFlight = null;
    }
  })();

  refreshInFlight = entry;
  return entry.promise;
}

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
  // Packaged builds ship the icon inside dist/ (via Vite's public dir);
  // in dev it is read straight from the repo. On Windows/Linux this sets the
  // window/taskbar icon — the packaged exe icon comes from electron-builder.
  const iconPath = app.isPackaged
    ? path.join(__dirname, '..', '..', 'dist', 'icon.png')
    : path.join(__dirname, '..', '..', 'public', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'SAS MAS Scorer',
    icon: iconPath,
    // Shown on ready-to-show (below), over the app's page colour
    // (--sas-gray-100), so the window never flashes white while the renderer
    // loads.
    show: false,
    backgroundColor: '#F4F4F4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Disable same-origin policy so renderer can call Viya APIs cross-origin.
      // Safe for a desktop app that only loads our own code.
      webSecurity: false,
    },
  });

  // Show the window once the renderer has painted its first frame. If the page
  // fails to load (dev server not up yet), or ready-to-show never fires, show
  // it anyway rather than leaving the app running without a window.
  const win = mainWindow;
  const showWindow = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', showWindow);
  win.webContents.once('did-fail-load', showWindow);
  const showFallback = setTimeout(showWindow, 5000);
  win.once('show', () => clearTimeout(showFallback));
  win.once('closed', () => clearTimeout(showFallback));

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, load from built dist files
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Open external links (target="_blank") in the user's default browser
  // instead of opening a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

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
    // A refresh still out for the previous connection is keyed to it and
    // writes its tokens there, so it is left to finish.
  });

  // Backward-compat alias used by client.ts
  ipcMain.handle('auth:getViyaUrl', () => {
    return getConnection()?.viyaUrl ?? null;
  });

  // --- Auth Status ---

  ipcMain.handle('auth:isAuthenticated', async () => {
    const tokens = getTokens();
    if (!tokens) return false;
    if (tokens.expiresAt > Date.now()) return true;
    // The access token ran out while the app was closed (or idle). Renew it
    // silently with the stored refresh token rather than reporting "Not
    // connected" and sending the user through the login window again.
    return (await refreshSession()) !== null;
  });

  // --- Get Access Token (with auto-refresh) ---

  ipcMain.handle('auth:getAccessToken', async () => {
    const tokens = getTokens();
    if (!tokens) return null;

    // If token is still valid (with 60-second buffer), return it
    if (tokens.expiresAt - 60_000 > Date.now()) {
      return tokens.accessToken;
    }

    // Token expired or about to expire — refresh it (deduplicated)
    return refreshSession();
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
