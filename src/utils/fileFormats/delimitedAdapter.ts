// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FileFormatAdapter, ParsedTable } from './types';

export const parseDelimited = (text: string, delimiter: string): ParsedTable => {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows: unknown[][] = lines.slice(1).map(parseRow);
  return { headers, rows };
};

export const createDelimitedAdapter = (
  id: string,
  label: string,
  extensions: string[],
  delimiter: string
): FileFormatAdapter => ({
  id,
  label,
  extensions,
  defaultDelimiter: delimiter,
  async parse(file, options) {
    const text = await file.text();
    return parseDelimited(text, options?.delimiter ?? delimiter);
  },
});

export const csvAdapter = createDelimitedAdapter('csv', 'CSV', ['.csv'], ',');
export const tsvAdapter = createDelimitedAdapter('tsv', 'TSV', ['.tsv', '.tab'], '\t');
