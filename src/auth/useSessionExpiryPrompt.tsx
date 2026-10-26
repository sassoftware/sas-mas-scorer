// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SessionExpiredModal } from '../components/common/AuthErrorModal';
import { markSessionActive, SessionRenewal, setSessionExpiredHandler } from './sessionExpiry';

interface SessionExpiryPromptOptions {
  /**
   * False while the provider does not think the user is signed in (still
   * checking at start-up, or never signed in): no prompt, the request fails
   * as before and the view shows its own sign-in state.
   */
  canPrompt: () => boolean;
  /**
   * Checks the session again before prompting. True means it is still valid
   * (a single service answered 401): the request is retried once, no prompt.
   */
  confirmSession: () => Promise<boolean>;
  /** Signs in again. Must open any popup synchronously, inside the click. Resolves on success, rejects otherwise. */
  signIn: () => Promise<void>;
  /** The prompt was closed without signing in. */
  onDismiss?: () => void;
  /** Offer a page reload as well (jobdef). */
  onReload?: () => void;
}

/**
 * Registers the auth provider as the one place that answers "the session has
 * ended" for the API client, and renders the sign-in prompt while it is open.
 * Returns the prompt element (or null) for the provider to render.
 */
export function useSessionExpiryPrompt(options: SessionExpiryPromptOptions): React.ReactElement | null {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((result: SessionRenewal) => void) | null>(null);

  const settle = useCallback((result: SessionRenewal) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOpen(false);
    setBusy(false);
    setError(null);
  }, []);

  useEffect(
    () =>
      setSessionExpiredHandler(async () => {
        const current = optionsRef.current;
        if (!current.canPrompt()) return 'unavailable';
        if (await current.confirmSession().catch(() => false)) return 'renewed';
        return new Promise<SessionRenewal>((resolve) => {
          resolveRef.current = resolve;
          setError(null);
          setOpen(true);
        });
      }),
    []
  );

  // Unmounting with the prompt open (connection switch): let the waiting
  // requests fail rather than hang.
  useEffect(() => () => resolveRef.current?.('dismissed'), []);

  const handleSignIn = useCallback(() => {
    setBusy(true);
    setError(null);
    optionsRef.current
      .signIn()
      .then(() => {
        markSessionActive();
        settle('renewed');
      })
      .catch((err: unknown) => {
        setBusy(false);
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
        setError(
          `The sign-in did not complete${message ? ` (${message})` : ''}.` +
            (__BUILD_MODE__ === 'electron'
              ? ' Try again, or check the connection settings.'
              : ' If no sign-in window opened, your browser may have blocked it: allow pop-ups for this site and try again.')
        );
      });
  }, [settle]);

  const handleClose = useCallback(() => {
    optionsRef.current.onDismiss?.();
    settle('dismissed');
  }, [settle]);

  if (!open) return null;
  return (
    <SessionExpiredModal
      onSignIn={handleSignIn}
      onClose={handleClose}
      busy={busy}
      error={error}
      onReload={options.onReload}
    />
  );
}
