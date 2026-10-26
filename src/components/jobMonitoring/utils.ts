// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ExecutionJobState } from '../../types/jobExecution';
import { saveTextFile } from '../../utils/download';
import type { JobStatsWindow } from '../../hooks/useJobMonitoring';

// Display labels for job states. The API values are camelCase ('timedOut')
// and US-spelled ('canceled'); the badge, the filter chips and the stats
// caption all read from here so one screen never mixes spellings or shows
// "TIMEDOUT" without a word break.
export const STATE_LABELS: Record<ExecutionJobState, string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
  timedOut: 'Timed Out',
};

// The statistics window, as the chips name it and as the figures describe it.
export const STATS_WINDOW_LABELS: Record<JobStatsWindow, { chip: string; phrase: string }> = {
  '24h': { chip: '24 hours', phrase: 'in the last 24 hours' },
  '7d': { chip: '7 days', phrase: 'in the last 7 days' },
  '30d': { chip: '30 days', phrase: 'in the last 30 days' },
  all: { chip: 'All', phrase: 'all time' },
};

// Label for a state, falling back to the raw value for anything unexpected.
export const formatJobState = (state: ExecutionJobState): string =>
  STATE_LABELS[state] ?? state;

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

// Download a string as a file (with the copy fallback inside VA embeds).
export const downloadText = (text: string, filename: string): void => {
  saveTextFile(text, filename);
};
