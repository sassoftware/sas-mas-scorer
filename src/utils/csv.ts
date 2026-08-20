// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Strict RFC-4180 CSV parse/serialize used by the Business Rules import.
 *
 * Deliberately separate from utils/fileFormats/delimitedAdapter.ts: that parser
 * splits on newlines before parsing (breaking quoted multiline fields) and trims
 * every cell — but rule expressions carry significant leading/trailing spaces
 * (e.g. the expression `" 1"` in the businessRules API examples), so cells here
 * are preserved byte-for-byte.
 */

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse CSV text into rows of raw string cells.
 * Handles CRLF/LF/CR record ends, quoted fields containing delimiters,
 * embedded newlines, and "" escapes. A single trailing empty record
 * (from a final newline) is dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      endField();
      i += 1;
    } else if (ch === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  // Flush the last record unless it is a single empty field after a final newline
  if (field !== '' || row.length > 0) {
    endRow();
  }
  return rows;
}

/** Serialize rows back to CSV: quote only when needed, "" escapes, CRLF records, no BOM. */
export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (/[",\r\n]/.test(cell)) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(',')
    )
    .join('\r\n');
}

/** Trigger a browser download of text content. */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/csv;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
