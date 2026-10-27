// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The bridge between the API client, which notices that the SAS Viya session
 * has ended, and the auth provider, which asks the user to sign in again.
 *
 * Many requests can fail at once (a page loads five things, a job list polls),
 * but the user sees one prompt: every request that hits the expired session
 * while the prompt is open waits on the same promise, and is retried once
 * after a successful sign-in. If the user closes the prompt, later failures do
 * not reopen it until a request succeeds again or they sign in another way.
 */

/**
 * - `renewed`: signed in again (or the session turned out to be fine); retry once.
 * - `dismissed`: the user closed the prompt; fail the request.
 * - `unavailable`: no prompt applies (not signed in to begin with, or no
 *   provider listening); fail the request as before.
 */
export type SessionRenewal = 'renewed' | 'dismissed' | 'unavailable';

/**
 * `force`: skip the quiet check that the session is still valid and ask the
 * user to sign in. Used when a request was turned away again right after that
 * check said the session was fine (for example, the tokens are unexpired but
 * SAS Logon no longer accepts them for every service).
 */
type SessionExpiredHandler = (options: { force: boolean }) => Promise<SessionRenewal>;

let handler: SessionExpiredHandler | null = null;
let pending: Promise<SessionRenewal> | null = null;
let dismissed = false;

/** Shown when a request fails because the session ended and was not renewed. */
export const SESSION_EXPIRED_MESSAGE =
  __BUILD_MODE__ === 'jobdef'
    ? 'Your SAS Viya session has expired. Reload the page to sign in again.'
    : 'Your SAS Viya session has expired. Sign in again to continue.';

/** The auth provider registers the prompt here. Returns the unregister function. */
export function setSessionExpiredHandler(next: SessionExpiredHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Called by the API client on a response that shows the session has ended. */
export function requestSessionRenewal(options: { force?: boolean } = {}): Promise<SessionRenewal> {
  if (pending) return pending;
  if (dismissed) return Promise.resolve('dismissed');
  if (!handler) return Promise.resolve('unavailable');
  const current = handler({ force: options.force ?? false })
    .catch((): SessionRenewal => 'dismissed')
    .then((result) => {
      if (result === 'dismissed') dismissed = true;
      if (pending === current) pending = null;
      return result;
    });
  pending = current;
  return current;
}

/** A request succeeded or the user signed in: the next expiry may prompt again. */
export function markSessionActive(): void {
  dismissed = false;
}
