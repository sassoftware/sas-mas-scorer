// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured API errors and the "Copy details" text built from them.
 *
 * The API client rejects with ViyaApiError: its message is the readable text
 * the views already show, and it also keeps what an administrator or support
 * needs to find the failure — HTTP status, the SAS errorCode, the request
 * method and path. Every failure is also kept in a short in-memory list, so an
 * error alert can find the failure behind the message it shows and offer its
 * details for copying, without each view passing the error object through.
 */

export interface FailureDetails {
  /** HTTP status, when the server answered. */
  status?: number;
  /** The SAS error code from an application/vnd.sas.error+json body (0 when the service sets none). */
  errorCode?: number;
  /** HTTP method, upper case. */
  method?: string;
  /** Request path, without the query string. */
  path?: string;
  /** The server's remediation text, when it sends one (most Viya services send null). */
  remediation?: string;
  /** Axios error code for failures without a response (ERR_NETWORK, ECONNABORTED). */
  code?: string;
}

export class ViyaApiError extends Error {
  readonly status?: number;
  readonly errorCode?: number;
  readonly method?: string;
  readonly path?: string;
  readonly remediation?: string;
  readonly code?: string;

  constructor(message: string, details: FailureDetails = {}) {
    super(message);
    this.name = 'ViyaApiError';
    this.status = details.status;
    this.errorCode = details.errorCode;
    this.method = details.method;
    this.path = details.path;
    this.remediation = details.remediation;
    this.code = details.code;
  }
}

export interface RecordedFailure extends FailureDetails {
  message: string;
  /** ISO timestamp. */
  time: string;
}

const MAX_RECORDED = 20;
const recentFailures: RecordedFailure[] = [];

/** Keep a failure for the Copy details action. Newest first. */
export function recordFailure(message: string, details: FailureDetails = {}): void {
  recentFailures.unshift({ message, ...details, time: new Date().toISOString() });
  if (recentFailures.length > MAX_RECORDED) recentFailures.length = MAX_RECORDED;
}

/** The newest recorded failure whose message appears in the given alert text. */
export function findRecordedFailure(text: string): RecordedFailure | undefined {
  if (!text) return undefined;
  return recentFailures.find((failure) => failure.message && text.includes(failure.message));
}

/** Plain-text report for a support ticket or a message to an administrator. */
export function formatFailureReport(alertText: string, failure?: RecordedFailure): string {
  const lines = [`Error: ${alertText.trim()}`];
  if (failure) {
    if (failure.status !== undefined) lines.push(`HTTP status: ${failure.status}`);
    if (failure.errorCode !== undefined) lines.push(`SAS error code: ${failure.errorCode}`);
    if (failure.code) lines.push(`Client error code: ${failure.code}`);
    if (failure.path) lines.push(`Request: ${[failure.method, failure.path].filter(Boolean).join(' ')}`);
    if (failure.remediation) lines.push(`Remediation: ${failure.remediation}`);
    lines.push(`Time: ${failure.time}`);
  } else {
    lines.push(`Time: ${new Date().toISOString()}`);
  }
  lines.push(`App: MAS Module Scorer ${__APP_VERSION__} (${__BUILD_MODE__} build)`);
  lines.push(`View: ${window.location.hash || '#/'}`);
  lines.push(`Browser: ${navigator.userAgent}`);
  return lines.join('\n');
}

/**
 * Copy text to the clipboard. Falls back to a hidden textarea and
 * execCommand('copy') where the async clipboard is blocked (a Visual Analytics
 * embed without the clipboard-write permission). Resolves false when both fail.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // select() moves focus into the textarea; give it back afterwards so a
    // keyboard user stays on the button they pressed.
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
      previousFocus?.focus();
    }
  }
}
