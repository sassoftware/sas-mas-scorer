// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * One way to save a generated file from any page. Inside SAS Visual
 * Analytics the app runs in an iframe that may be sandboxed without
 * `allow-downloads`; the browser then drops the download without telling
 * anyone. When that is certain (or cannot be ruled out), the content is
 * also handed to the DownloadFallback notice, which offers to copy it.
 */

export const DOWNLOAD_FALLBACK_EVENT = 'mas-scorer:download-fallback';

export interface DownloadFallbackDetail {
  filename: string;
  content: string;
  /** true: downloads are blocked here; false: they may be. */
  blocked: boolean;
}

/** true = blocked, false = allowed, null = cannot tell (cross-origin parent). */
export function downloadsBlocked(): boolean | null {
  if (window === window.top) return false;
  try {
    const frame = window.frameElement;
    if (!frame) return null;
    const sandbox = frame.getAttribute('sandbox');
    if (sandbox === null) return false;
    return !sandbox.split(/\s+/).includes('allow-downloads');
  } catch {
    return null;
  }
}

/** Replace characters that Windows and macOS refuse in file names. */
export function safeFilename(name: string): string {
  const printable = [...name].filter((ch) => ch.charCodeAt(0) >= 32).join('');
  const cleaned = printable.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return cleaned || 'download';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke on the next tick: some browsers cancel a download whose URL is
  // revoked synchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Save text as a file, with a copy fallback where downloads are blocked. */
export function saveTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
  const name = safeFilename(filename);
  const blocked = downloadsBlocked();
  if (blocked !== true) triggerDownload(new Blob([content], { type: mimeType }), name);
  if (blocked !== false) {
    window.dispatchEvent(
      new CustomEvent<DownloadFallbackDetail>(DOWNLOAD_FALLBACK_EVENT, {
        detail: { filename: name, content, blocked: blocked === true },
      })
    );
  }
}
