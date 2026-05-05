// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FileFormatAdapter } from './types';

// Accepts either JSONL (one JSON object per line) or a single JSON array of objects.
export const jsonlAdapter: FileFormatAdapter = {
  id: 'jsonl',
  label: 'JSON / JSONL',
  extensions: ['.jsonl', '.ndjson', '.json'],
  async parse(file) {
    const text = await file.text();
    const records = parseRecords(text);

    if (records.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = collectHeaders(records);
    const rows: unknown[][] = records.map(rec =>
      headers.map(h => {
        const v = (rec as Record<string, unknown>)[h];
        return v === undefined ? null : v;
      })
    );

    return { headers, rows };
  },
};

const parseRecords = (text: string): unknown[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Single JSON array: [{...}, {...}]
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array of objects');
    }
    return parsed;
  }

  const records: unknown[] = [];
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const s = line.trim();
    if (!s) return;
    try {
      records.push(JSON.parse(s));
    } catch {
      throw new Error(`Invalid JSON on line ${idx + 1}`);
    }
  });
  return records;
};

const collectHeaders = (records: unknown[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  // Sample up to first 100 records so large files don't pay an O(N) header scan.
  const sampleSize = Math.min(records.length, 100);
  for (let i = 0; i < sampleSize; i++) {
    const rec = records[i];
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
      Object.keys(rec as Record<string, unknown>).forEach(k => {
        if (!seen.has(k)) {
          seen.add(k);
          ordered.push(k);
        }
      });
    }
  }
  return ordered;
};
