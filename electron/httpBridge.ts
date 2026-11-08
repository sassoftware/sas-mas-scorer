// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP bridge: the renderer's only way onto the network.
 *
 * The renderer runs with web security on and a CSP that allows no network
 * access, so every SAS Viya and SCR request is handed to the main process
 * here. That keeps the Viya access token in the main process: the renderer
 * never sees it, and the token is attached only to requests for the active
 * connection's own origin.
 *
 *   kind 'viya' — must target the active connection's origin; the bearer token
 *                 is added here. Without a token the bridge answers 401 so the
 *                 renderer's usual sign-in flow runs.
 *   kind 'scr'  — SAS Container Runtime endpoints the user added: http(s)
 *                 only, never with the Viya token or cookies, and not to
 *                 link-local / cloud metadata addresses or container-engine
 *                 API ports.
 */

import { ipcMain, net, type IpcMainInvokeEvent } from 'electron';

export type BridgeKind = 'viya' | 'scr';

export interface BridgeRequest {
  id: string;
  kind: BridgeKind;
  url: string;
  method: string;
  headers: [string, string][];
  body?: Uint8Array;
}

export interface BridgeResponse {
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  body?: Uint8Array;
  url?: string;
  error?: { kind: 'abort' | 'network' | 'refused'; message: string };
}

export interface BridgeOptions {
  /** True when the IPC call comes from the app's own main frame. */
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  /** Origin of the active SAS Viya connection, or null. */
  activeViyaOrigin: () => string | null;
  /** A valid access token for the active connection (refreshed if needed), or null. */
  getValidAccessToken: () => Promise<string | null>;
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/** Ports of container-engine APIs (Docker/Podman over TCP): never reachable through the bridge. */
const BLOCKED_PORTS = new Set(['2375', '2376']);
/** Headers the renderer may not set; the bridge decides on credentials. */
const STRIPPED_REQUEST_HEADERS = new Set(['authorization', 'cookie', 'host', 'origin', 'referer', 'proxy-authorization']);
const STRIPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

const inflight = new Map<string, AbortController>();

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Link-local and cloud-metadata hosts (169.254.0.0/16, fe80::/10, metadata names). */
const isLinkLocalOrMetadata = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^169\.254\./.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;
  if (host === 'fd00:ec2::254') return true;
  return false;
};

const refuse = (message: string): BridgeResponse => ({ error: { kind: 'refused', message } });

const isValidRequest = (req: unknown): req is BridgeRequest => {
  if (!req || typeof req !== 'object') return false;
  const r = req as Record<string, unknown>;
  return (
    typeof r.id === 'string' && r.id.length <= 64 &&
    (r.kind === 'viya' || r.kind === 'scr') &&
    typeof r.url === 'string' && r.url.length <= 16_384 &&
    typeof r.method === 'string' &&
    Array.isArray(r.headers) &&
    r.headers.every((h) => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string') &&
    (r.body === undefined || r.body instanceof Uint8Array)
  );
};

async function handleRequest(req: BridgeRequest, options: BridgeOptions): Promise<BridgeResponse> {
  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    return refuse('Invalid URL.');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return refuse(`Only http and https URLs can be requested (${target.protocol}).`);
  }
  if (target.username || target.password) {
    return refuse('URLs with user names or passwords are not allowed.');
  }
  const method = req.method.toUpperCase();
  if (!METHODS.has(method)) return refuse(`HTTP method ${req.method} is not allowed.`);

  const headers = new Headers();
  for (const [name, value] of req.headers) {
    if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }

  if (req.kind === 'viya') {
    const viyaOrigin = options.activeViyaOrigin();
    if (!viyaOrigin || target.origin !== viyaOrigin) {
      return refuse('SAS Viya requests can only go to the active connection.');
    }
    const token = await options.getValidAccessToken();
    if (!token) {
      // Signed out or the session ended: answer like the server would, so the
      // renderer's sign-in prompt and retry run as for an expired token.
      return { status: 401, statusText: 'Unauthorized', headers: [], body: new Uint8Array(0), url: req.url };
    }
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    if (isLinkLocalOrMetadata(target.hostname)) {
      return refuse('Link-local and cloud metadata addresses cannot be called.');
    }
    if (BLOCKED_PORTS.has(target.port)) {
      return refuse(`Port ${target.port} (container engine API) cannot be called.`);
    }
  }

  const controller = new AbortController();
  inflight.set(req.id, controller);
  const timer = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
  try {
    const response = await net.fetch(target.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' || !req.body ? undefined : new Uint8Array(req.body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
    // A Viya request redirected to another host would carry nothing secret
    // (Chromium drops Authorization on cross-origin redirects), but its answer
    // is not a Viya answer either.
    // net.fetch can leave response.url empty when there was no redirect.
    const finalUrl = response.url || target.toString();
    if (req.kind === 'viya' && originOf(finalUrl) !== target.origin) {
      return refuse(`SAS Viya redirected the request to another host (${originOf(finalUrl)}).`);
    }
    const responseHeaders: [string, string][] = [];
    response.headers.forEach((value, name) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.push([name, value]);
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, statusText: response.statusText, headers: responseHeaders, body, url: finalUrl };
  } catch (err) {
    if (controller.signal.aborted) return { error: { kind: 'abort', message: 'The request was cancelled.' } };
    return { error: { kind: 'network', message: err instanceof Error ? err.message : String(err) } };
  } finally {
    clearTimeout(timer);
    inflight.delete(req.id);
  }
}

export function registerHttpBridge(options: BridgeOptions): void {
  ipcMain.handle('http:request', async (event, req: unknown): Promise<BridgeResponse> => {
    if (!options.isTrustedSender(event)) return refuse('Request from an untrusted frame.');
    if (!isValidRequest(req)) return refuse('Malformed request.');
    return handleRequest(req, options);
  });

  ipcMain.handle('http:abort', (event, id: unknown) => {
    if (!options.isTrustedSender(event) || typeof id !== 'string') return;
    inflight.get(id)?.abort();
  });
}
