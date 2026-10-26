// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Pure helpers behind the log viewer's problem counts, severity filter and
// search. Every list here holds line indices into the full `lines` array in
// ascending order, so a position survives lines being appended to a live log.

import { LogLine } from '../../types/jobExecution';

export interface LogProblems {
  /** error + fatal lines. */
  errorCount: number;
  warningCount: number;
  errorLines: number[];
  warningLines: number[];
  /** Errors and warnings together, in log order (the "Errors and warnings" filter). */
  problemLines: number[];
}

const isErrorType = (type: LogLine['type'] | undefined): boolean =>
  type === 'error' || type === 'fatal';

/** One pass over the log: counts plus the line lists for stepping and filtering. */
export const summarizeProblems = (lines: LogLine[]): LogProblems => {
  const errorLines: number[] = [];
  const warningLines: number[] = [];
  const problemLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const type = lines[i]?.type;
    if (isErrorType(type)) {
      errorLines.push(i);
      problemLines.push(i);
    } else if (type === 'warning') {
      warningLines.push(i);
      problemLines.push(i);
    }
  }
  return {
    errorCount: errorLines.length,
    warningCount: warningLines.length,
    errorLines,
    warningLines,
    problemLines,
  };
};

/** The first error line's text, or null — the failure reason for a failed job. */
export const firstErrorLine = (lines: LogLine[]): { index: number; text: string } | null => {
  for (let i = 0; i < lines.length; i++) {
    if (isErrorType(lines[i]?.type)) return { index: i, text: lines[i].line ?? '' };
  }
  return null;
};

/**
 * Lines containing `needle` (already lower-cased, non-empty), limited to
 * `within` when a filter is active (null = every line).
 */
export const matchLineIndices = (
  lines: LogLine[],
  needle: string,
  within: number[] | null
): number[] => {
  const result: number[] = [];
  const test = (i: number): void => {
    const text = lines[i]?.line;
    if (text && text.toLowerCase().includes(needle)) result.push(i);
  };
  if (within) within.forEach(test);
  else for (let i = 0; i < lines.length; i++) test(i);
  return result;
};

/** Index of the first entry of the sorted `list` greater than `value`, or -1. */
export const firstAfter = (list: number[], value: number): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? lo : -1;
};

/** Index of the last entry of the sorted `list` smaller than `value`, or -1. */
export const lastBefore = (list: number[], value: number): number => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};

/**
 * The row a line is shown on: the line itself when unfiltered, its position
 * in `visible` when filtered, or -1 when the filter hides it.
 */
export const rowOfLine = (line: number, visible: number[] | null): number => {
  if (!visible) return line;
  const pos = firstAfter(visible, line - 1);
  return pos >= 0 && visible[pos] === line ? pos : -1;
};

/** Split `text` into plain and matching parts for highlighting (case-insensitive). */
export const splitMatches = (
  text: string,
  needle: string
): { text: string; match: boolean }[] => {
  const parts: { text: string; match: boolean }[] = [];
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
};
