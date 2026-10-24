// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Pulls the lines that explain a failed score execution out of its SAS log.
// A failed execution carries no error message of its own, so the log is the
// only diagnostic; the user sees these lines first and the full log on demand.

export interface LogExcerpt {
  /** What the lines are: the ERROR lines, else the WARNINGs, else the log's tail. */
  kind: 'errors' | 'warnings' | 'tail';
  lines: string[];
  /** True when more matching lines existed than were kept. */
  clipped: boolean;
}

const MAX_LINES = 40;
const TAIL_LINES = 15;

/** Message lines starting with `prefix`, each with its indented continuation lines. */
function messages(lines: string[], prefix: RegExp): { lines: string[]; clipped: boolean } {
  const out: string[] = [];
  let clipped = false;
  for (let i = 0; i < lines.length; i++) {
    if (!prefix.test(lines[i])) continue;
    const block = [lines[i]];
    // SAS wraps a long message onto following lines indented with spaces.
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !prefix.test(lines[i + 1])) {
      block.push(lines[++i]);
    }
    if (out.length + block.length > MAX_LINES) {
      clipped = true;
      // Keep at least the start of a single over-long message.
      if (out.length === 0) out.push(...block.slice(0, MAX_LINES));
      break;
    }
    out.push(...block);
  }
  return { lines: out, clipped };
}

export function logExcerpt(log: string): LogExcerpt {
  const lines = log.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const errors = messages(lines, /^\s*ERROR(\s+\d+-\d+)?:/);
  if (errors.lines.length > 0) return { kind: 'errors', ...errors };
  const warnings = messages(lines, /^\s*WARNING(\s+\d+-\d+)?:/);
  if (warnings.lines.length > 0) return { kind: 'warnings', ...warnings };
  const filled = lines.filter((l) => l.trim() !== '');
  return { kind: 'tail', lines: filled.slice(-TAIL_LINES), clipped: filled.length > TAIL_LINES };
}
