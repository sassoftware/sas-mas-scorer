// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * A fetch() for the desktop app that sends the request through the main
 * process (electron/httpBridge.ts) instead of from the renderer.
 *
 * The renderer runs with web security on and a CSP without network access, so
 * this is how it reaches SAS Viya and SCR endpoints. For 'viya' requests the
 * main process adds the access token; the renderer never holds it.
 *
 * It behaves like fetch(): the body is read from a standard Request (strings,
 * FormData, Blob), aborting the signal cancels the request in the main
 * process, and a network failure rejects with a TypeError ("Failed to fetch"),
 * which axios turns into its usual ERR_NETWORK error.
 */

let sequence = 0;

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

const abortError = (): DOMException => new DOMException('The request was cancelled.', 'AbortError');

export const isElectronBridgeAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.electronAPI?.httpRequest === 'function';

export function createBridgeFetch(kind: 'viya' | 'scr'): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const api = window.electronAPI;
    if (!api?.httpRequest) throw new TypeError('Failed to fetch: the desktop HTTP bridge is not available.');

    const request = new Request(input, init);
    const signal = request.signal;
    if (signal.aborted) throw abortError();

    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer());
    const headers: [string, string][] = [];
    request.headers.forEach((value, name) => headers.push([name, value]));

    const id = `${kind}-${++sequence}`;
    const onAbort = () => {
      void api.httpAbort(id);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await api.httpRequest({ id, kind, url: request.url, method, headers, body });
      if (signal.aborted || result.error?.kind === 'abort') throw abortError();
      if (result.error) throw new TypeError(`Failed to fetch: ${result.error.message}`);
      const status = result.status ?? 0;
      return new Response(NULL_BODY_STATUS.has(status) || method === 'HEAD' ? null : (result.body ? new Uint8Array(result.body) : null), {
        status,
        statusText: result.statusText ?? '',
        headers: result.headers ?? [],
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
}
