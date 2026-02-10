// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build mode constant injected by Vite
declare const __BUILD_MODE__: 'standard' | 'jobdef';
