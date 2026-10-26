// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Open Sans for the single-file jobdef build. SAS Job Execution serves the
 * page with a Content-Security-Policy whose default-src 'self' (no font-src)
 * blocks @font-face data: URLs, but a FontFace built from bytes is not a
 * fetch, so the policy does not apply. Same faces and ranges as fonts.css.
 */
import latinUrl from './fonts/open-sans-latin-wght-normal.woff2?inline';
import latinExtUrl from './fonts/open-sans-latin-ext-wght-normal.woff2?inline';

const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, ' +
  'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, ' +
  'U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const bytesOf = (dataUrl: string): ArrayBuffer => {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
};

export function registerJobdefFonts(): void {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  for (const [url, unicodeRange] of [[latinUrl, LATIN_RANGE], [latinExtUrl, LATIN_EXT_RANGE]] as const) {
    try {
      const face = new FontFace('Open Sans', bytesOf(url), {
        style: 'normal',
        weight: '300 800',
        display: 'swap',
        unicodeRange,
      });
      document.fonts.add(face);
    } catch {
      // Without the font the stack falls back to Arial, as before 2.11.
    }
  }
}
