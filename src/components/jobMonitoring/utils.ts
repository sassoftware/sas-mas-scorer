// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Format a millisecond duration as "1h 23m", "1m 14s", or "12s".
export const formatDuration = (ms: number | null | undefined): string => {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// Format an ISO timestamp as a locale-friendly string. Returns "—" for null/undef.
export const formatTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
};

// Live elapsed from start to a reference "now".
export const elapsedSince = (iso: string, now: number = Date.now()): number => {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, now - start);
};

// Make a string safe to use as a filename across Windows/macOS/Linux. Caps
// the length so a very long job name doesn't produce an unwieldy filename.
export const sanitizeFilename = (name: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (cleaned || 'job').slice(0, 80);
};

// Trigger a browser download of a string as a file. We Blob → object URL →
// click → revoke; defer the revoke so the download has time to start.
export const downloadText = (text: string, filename: string): void => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
