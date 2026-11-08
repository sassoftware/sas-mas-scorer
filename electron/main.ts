// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Electron main process — window management, IPC handlers, OAuth flow.
 */

import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  initTokenStore,
  flushTokenStore,
} from './tokenStore';
import { registerHttpBridge } from './httpBridge';

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

/**
 * A valid access token for the active connection: the stored one while it has
 * more than a minute left, otherwise a refreshed one (deduplicated). Null when
 * signed out or the session can no longer be renewed. Main process only: the
 * token is attached by the HTTP bridge and never handed to the renderer.
 */
async function getValidAccessToken(): Promise<string | null> {
  const tokens = getTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  return refreshSession();
}

// --- Renderer trust ---

const DEV_URL = 'http://localhost:3000';
const loadsFromDevServer = (): boolean => process.env.NODE_ENV === 'development' || !app.isPackaged;
const appIndexPath = (): string => path.join(__dirname, '..', '..', 'dist', 'index.html');

/** True when a URL is the app's own page (the packaged index.html, or the dev server in development). */
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (loadsFromDevServer()) return parsed.origin === DEV_URL;
    if (parsed.protocol !== 'file:') return false;
    const norm = (p: string) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
    return norm(fileURLToPath(parsed)) === norm(appIndexPath());
  } catch {
    return false;
  }
}

/** IPC calls are honoured only from the main window's top frame showing the app's own page. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    !!frame &&
    frame === mainWindow.webContents.mainFrame &&
    isAppUrl(frame.url)
  );
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
      sandbox: true,
      // Same-origin policy on: the renderer cannot read local files or other
      // sites. SAS Viya and SCR requests go through the main-process HTTP
      // bridge (electron/httpBridge.ts), which also keeps the access token.
      webSecurity: true,
      allowRunningInsecureContent: false,
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
  if (loadsFromDevServer()) {
    mainWindow.loadURL(DEV_URL);
  } else {
    // In production, load from built dist files
    mainWindow.loadFile(appIndexPath());
  }

  // Open external links (target="_blank") in the user's default browser
  // instead of opening a new Electron window. Only web links: file:, smb:,
  // javascript: and custom protocol handlers are never passed to the OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The window only ever shows the app itself; a link or script that would
  // navigate it elsewhere is stopped (web links open in the browser instead).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC Handlers ---

/**
 * What the renderer sees of a connection: everything except the client
 * secret, which stays in the main process (only whether one is saved).
 */
interface PublicConnection extends Omit<SavedConnection, 'clientSecret'> {
  hasClientSecret: boolean;
}

function toPublic(conn: SavedConnection | null): PublicConnection | null {
  if (!conn) return null;
  const { clientSecret, ...rest } = conn;
  return { ...rest, hasClientSecret: !!clientSecret };
}

/** Connection fields from the renderer, checked; unknown keys are dropped. */
interface ConnectionInput {
  name: string;
  viyaUrl: string;
  clientId: string;
  /** Undefined on update: keep the saved secret. '' clears it. */
  clientSecret?: string;
  insecureSsl: boolean;
  color?: string;
}

function readConnectionInput(value: unknown): ConnectionInput {
  const v = (value ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
  if (!str(v.name, 200) || !str(v.viyaUrl, 2048) || !str(v.clientId, 200) || typeof v.insecureSsl !== 'boolean') {
    throw new Error('Invalid connection settings.');
  }
  if (v.clientSecret !== undefined && !str(v.clientSecret, 4096)) throw new Error('Invalid client secret.');
  if (v.color !== undefined && !(typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color))) throw new Error('Invalid color.');
  const url = new URL(v.viyaUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The SAS Viya URL must start with https:// or http://.');
  return {
    name: v.name,
    viyaUrl: v.viyaUrl,
    clientId: v.clientId,
    clientSecret: v.clientSecret as string | undefined,
    insecureSsl: v.insecureSsl,
    color: v.color as string | undefined,
  };
}

/** ipcMain.handle, answering only the app's own page in the main window. */
function handleTrusted<A extends unknown[], R>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: A) => R
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`IPC ${channel} refused: untrusted sender.`);
    return listener(event, ...(args as A));
  });
}

function registerIpcHandlers(): void {
  // --- Connection Management ---

  handleTrusted('conn:getAll', () => getAllConnections().map((c) => toPublic(c)));

  handleTrusted('conn:getActive', () => toPublic(getConnection()));

  handleTrusted('conn:add', (_event, value: unknown) => {
    const input = readConnectionInput(value);
    const saved = addConnection({ ...input, clientSecret: input.clientSecret ?? '' });
    return toPublic(saved);
  });

  handleTrusted('conn:update', (_event, value: unknown) => {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') throw new Error('Invalid connection id.');
    const existing = getAllConnections().find((c) => c.id === id);
    if (!existing) return;
    const input = readConnectionInput(value);
    updateConnection({ ...input, id, clientSecret: input.clientSecret ?? existing.clientSecret });
    // Re-apply SSL if this is the active connection
    if (id === getActiveConnectionId()) {
      applySslConfig();
    }
  });

  handleTrusted('conn:delete', (_event, id: unknown) => {
    if (typeof id === 'string') deleteConnection(id);
  });

  handleTrusted('conn:setActive', (_event, id: unknown) => {
    if (typeof id !== 'string') return;
    setActiveConnection(id);
    applySslConfig();
    // A refresh still out for the previous connection is keyed to it and
    // writes its tokens there, so it is left to finish.
  });

  // Backward-compat alias used by client.ts
  handleTrusted('auth:getViyaUrl', () => {
    return getConnection()?.viyaUrl ?? null;
  });

  // --- Auth Status ---

  handleTrusted('auth:isAuthenticated', async () => {
    const tokens = getTokens();
    if (!tokens) return false;
    if (tokens.expiresAt > Date.now()) return true;
    // The access token ran out while the app was closed (or idle). Renew it
    // silently with the stored refresh token rather than reporting "Not
    // connected" and sending the user through the login window again.
    return (await refreshSession()) !== null;
  });

  // --- HTTP bridge (SAS Viya with the access token, SCR endpoints without) ---

  registerHttpBridge({
    isTrustedSender,
    activeViyaOrigin: () => {
      const url = getConnection()?.viyaUrl;
      if (!url) return null;
      try {
        return new URL(url).origin;
      } catch {
        return null;
      }
    },
    getValidAccessToken,
  });

  // --- Login ---

  handleTrusted('auth:startLogin', async () => {
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

  handleTrusted('auth:logout', () => {
    clearTokens();
  });
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  // Connections and tokens are read (and their secrets unsealed) before
  // anything can ask for them.
  await initTokenStore();
  registerIpcHandlers();
  applySslConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Settings and tokens are written in the background; quit once they are on disk.
let quitAfterFlush = false;
app.on('before-quit', (event) => {
  if (quitAfterFlush) return;
  event.preventDefault();
  quitAfterFlush = true;
  void flushTokenStore().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
