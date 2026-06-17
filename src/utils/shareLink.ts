// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { UIDefinition } from '../types/uiBuilder';

// Share links embed an entire UI App definition inside the URL so the link is
// self-contained: the recipient does not need the definition in their browser's
// localStorage. The definition is JSON-encoded, UTF-8 byte-encoded, then
// base64url-encoded (URL-safe, no padding) and carried in the `def` query
// parameter of the hash route, e.g.
//   <base>#/ui-apps/<id>?def=<token>&standalone=true
//
// Because all three delivery targets (Electron, SAS Job Execution / JobDefinition,
// and the standalone Webserver build) use HashRouter, the hash fragment is fully
// portable: the same `#/ui-apps/...?def=...` suffix can be appended to any
// target's base URL and resolves identically. This is why we expose the suffix
// separately from the full link.

/** Encode a UI definition into a URL-safe base64url token. */
export function encodeUIDefinition(def: UIDefinition): string {
  const json = JSON.stringify(def);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode a base64url token back into a UI definition, or null if invalid. */
export function decodeUIDefinition(token: string): UIDefinition | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as UIDefinition;
    // Validate the minimum shape needed to render and run the app.
    if (!parsed || !parsed.moduleId || !parsed.stepId || !parsed.layout) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the portable hash suffix (starting at `#`) for a shared UI App.
 * Append this to ANY target's base URL — Electron renderer, the Webserver
 * index.html, or the SAS Job Execution HTML — and it resolves the same way.
 */
export function buildShareHash(def: UIDefinition, standalone: boolean): string {
  const token = encodeUIDefinition(def);
  const flag = standalone ? '&standalone=true' : '';
  return `#/ui-apps/${encodeURIComponent(def.id)}?def=${token}${flag}`;
}

/**
 * Build a complete share link rooted at the current deployment's origin.
 * Convenient when sharing within the same deployment; use buildShareHash when
 * the recipient is on a different target.
 */
export function buildShareLink(def: UIDefinition, standalone: boolean): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}${buildShareHash(def, standalone)}`;
}
