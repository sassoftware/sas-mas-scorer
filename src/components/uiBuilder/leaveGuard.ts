// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * "Leave with unsaved changes?" for the UI Builder.
 *
 * The app uses a HashRouter without a data router, so react-router's
 * useBlocker is not available. Instead:
 * - in-app exits (sidebar, recent items) go through runWithLeaveGuard, which
 *   App.tsx wraps around the Layout callbacks, and the builder's own Back /
 *   breadcrumb call it too;
 * - browser Back / Forward are caught on popstate before react-router sees
 *   them and undone with history.go, the same revert react-router's own
 *   blocker uses; the move is replayed if the user chooses to leave;
 * - reload and tab close use beforeunload (browser and jobdef builds only:
 *   in Electron a beforeunload veto silently cancels closing the window).
 *
 * Only one guard is active at a time: the mounted builder's.
 */

/** Return true to hold the navigation (the guard will call proceed later). */
type LeaveGuard = (proceed: () => void) => boolean;

let activeGuard: LeaveGuard | null = null;

/** Run an in-app navigation, unless the active guard holds it for confirmation. */
export function runWithLeaveGuard(proceed: () => void): void {
  if (activeGuard && activeGuard(proceed)) return;
  proceed();
}

interface GuardOptions {
  /** True while there are unsaved changes. Read at navigation time. */
  isDirty: () => boolean;
  /** Ask the user; call proceed if they choose to leave. */
  confirm: (proceed: () => void) => void;
}

const isElectron = typeof window !== 'undefined' && !!(window as { electronAPI?: unknown }).electronAPI;

/** Read react-router's history index (its `idx` in history.state). */
const historyIndex = (state: unknown): number | null => {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
};

/**
 * Install the guard; returns the uninstaller. Call from an effect in the
 * builder so it lives exactly as long as the builder is mounted.
 */
export function installLeaveGuard({ isDirty, confirm }: GuardOptions): () => void {
  let released = false;
  // popstate events we caused ourselves (reverting a blocked Back), swallowed
  // so react-router never sees the round trip.
  let ownPops = 0;
  const homeIndex = historyIndex(window.history.state);

  const guard: LeaveGuard = (proceed) => {
    if (released || !isDirty()) return false;
    confirm(proceed);
    return true;
  };
  activeGuard = guard;

  const onPopState = (e: PopStateEvent) => {
    if (ownPops > 0) {
      ownPops -= 1;
      e.stopImmediatePropagation();
      return;
    }
    if (released || !isDirty()) return;
    const target = historyIndex(e.state);
    // Without both indexes the move cannot be undone; let it through rather
    // than strand the user.
    if (homeIndex === null || target === null || target === homeIndex) return;
    const delta = homeIndex - target;
    e.stopImmediatePropagation();
    ownPops += 1;
    window.history.go(delta);
    confirm(() => {
      released = true;
      window.history.go(-delta);
    });
  };

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (released || !isDirty()) return;
    e.preventDefault();
    // Older browsers need returnValue set to show the prompt.
    e.returnValue = '';
  };

  // Capture phase on window runs before react-router's own popstate listener.
  window.addEventListener('popstate', onPopState, true);
  if (!isElectron) window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    if (activeGuard === guard) activeGuard = null;
    window.removeEventListener('popstate', onPopState, true);
    if (!isElectron) window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
