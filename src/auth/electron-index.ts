// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Barrel export for Electron auth context.
 * Vite aliases ./auth to this file when BUILD_MODE=electron.
 */

export { SasAuthProvider, useSasAuth } from './ElectronAuthContext';
