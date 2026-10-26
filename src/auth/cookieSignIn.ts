// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CookieAuthenticationCredential } from '@sassoftware/sas-auth-browser';

// sas-auth-browser keeps its open sign-in popup here.
const currentPopup = (): Window | undefined =>
  (globalThis as { __sasAuthPopover?: Window }).__sasAuthPopover;

/**
 * Re-checks the cookie session. checkAuthenticated() caches its answer, so a
 * session that has since ended would still read as signed in without the
 * cache being dropped first.
 */
export async function isCookieSessionValid(auth: CookieAuthenticationCredential): Promise<boolean> {
  auth.invalidateCache();
  try {
    await auth.checkAuthenticated();
    return true;
  } catch {
    return false;
  }
}

/**
 * Signs in again through the SAS Logon popup. Call it straight from a click:
 * the popup opens synchronously, so the browser does not block it.
 *
 * loginPopup() never settles when the user closes the popup by hand, which
 * would leave the prompt spinning; the window is watched and the sign-in
 * rejected once it closes without a result.
 */
export function signInWithCookiePopup(auth: CookieAuthenticationCredential): Promise<void> {
  auth.invalidateCache();
  const login = auth.loginPopup();
  const closedByUser = new Promise<never>((_, reject) => {
    const timer = window.setInterval(() => {
      const popup = currentPopup();
      if (popup && !popup.closed) return;
      window.clearInterval(timer);
      // A successful sign-in closes the popup too; give its result a moment
      // to arrive first.
      window.setTimeout(() => reject(new Error('the sign-in window was closed')), 500);
    }, 500);
    login.then(
      () => window.clearInterval(timer),
      () => window.clearInterval(timer)
    );
  });
  return Promise.race([login, closedByUser]).then(() => {
    auth.invalidateCache();
  });
}
