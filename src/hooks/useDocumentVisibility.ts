// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';

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
