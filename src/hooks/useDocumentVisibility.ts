// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';

const isVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

// Returns whether the document is currently visible. Polling hooks use this
// to suspend background work while the user is on another tab so we don't
// hammer the SAS Viya API for nothing.
export const useDocumentVisibility = (): boolean => {
  const [visible, setVisible] = useState<boolean>(isVisible);

  useEffect(() => {
    const handler = () => setVisible(isVisible());
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
};

// Runs `onVisible` each time `visible` turns from false to true — i.e. the
// user comes back to a tab whose polling was suspended — so the page catches
// up at once instead of showing old data until the next interval fires. Not
// called on mount. The latest callback is used, so callers need not memoise it.
export const useOnBecameVisible = (visible: boolean, onVisible: () => void): void => {
  const callbackRef = useRef(onVisible);
  callbackRef.current = onVisible;
  const wasVisibleRef = useRef(visible);

  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (visible && !wasVisible) callbackRef.current();
  }, [visible]);
};
