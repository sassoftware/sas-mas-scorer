// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Parser for the multipart/mixed response of POST /businessRules/rules.
 * Parts are identified by Content-ID: Global-Issue, Rejected-csv, Accepted-csv.
 * The service rejects at rule-set granularity — when any row of a rule set
 * fails, every row of that rule set appears in the Rejected-csv part.
 */

import { CellIssue, ImportOutcome, MultipartPart, RULE_CSV_COLUMNS } from '../../types/rulesImport';
import { COL, FALLBACK_BOUNDARY } from './constants';
import { parseCsv, stripBom } from '../csv';
import { ruleSetKey } from './validate';

const GLOBAL_SENTINEL = 'no global errors.';
const REJECT_SENTINEL = 'no rejections.';

export function extractBoundary(contentTypeHeader: string | undefined, rawBody: string): string {
  if (contentTypeHeader) {
    const match = contentTypeHeader.match(/boundary="?([^";]+)"?/i);
    if (match) return match[1];
  }
  const bodyMatch = rawBody.match(/^--(\S+)/m);
  if (bodyMatch) return bodyMatch[1];
  return FALLBACK_BOUNDARY;
}

export function parseMultipartMixed(raw: string, contentTypeHeader?: string): MultipartPart[] {
  const boundary = extractBoundary(contentTypeHeader, raw);
  const segments = raw.split(`--${boundary}`);
  const parts: MultipartPart[] = [];

  // segments[0] is the preamble; a segment starting with "--" is the terminator
  for (let s = 1; s < segments.length; s++) {
    const segment = segments[s];
    if (segment.startsWith('--')) break;

    const lines = segment.split(/\r?\n/);
    let contentId = '';
    let contentType: string | undefined;
    let bodyStart = 0;
    // Consume header lines; the service emits blank lines between them
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        bodyStart = i + 1;
        continue;
      }
      const header = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!header) break;
      const name = header[1].toLowerCase();
      if (name === 'content-id') contentId = header[2].trim();
      else if (name === 'content-type') contentType = header[2].trim();
      bodyStart = i + 1;
    }
    const body = lines.slice(bodyStart).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    parts.push({ contentId, contentType, body });
  }
  return parts;
}

const findPart = (parts: MultipartPart[], id: string): MultipartPart | undefined =>
  parts.find((p) => p.contentId.toLowerCase() === id.toLowerCase());

/** Extract rule-set keys from CSV rows of a response part (may include a header row). */
const keysFromCsvBody = (body: string): { keys: string[]; rows: string[][] } => {
  const parsed = parseCsv(stripBom(body)).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (parsed.length === 0) return { keys: [], rows: [] };
  // Drop a leading header row if present
  const first = parsed[0].map((c) => c.trim().toLowerCase());
  const startIndex = first[0] === RULE_CSV_COLUMNS[0] && first[1] === RULE_CSV_COLUMNS[1] ? 1 : 0;
  const rows = parsed.slice(startIndex);
  const keys = new Set<string>();
  rows.forEach((row) => {
    if (row.length > COL.FOLDER_PATH) {
      keys.add(ruleSetKey(row[COL.FOLDER_PATH], row[COL.RULESET_NM]));
    }
  });
  return { keys: Array.from(keys), rows };
};

/**
 * Interpret the import response against the grid.
 * scopeRowIndexes = the grid rows that were sent (null = all rows).
 * httpStatus: 201 on success; 400 also carries the multipart body (e.g. when
 * a rule set exists under a different id than the CSV's ruleset_id).
 */
export function interpretImportResponse(
  raw: string,
  contentTypeHeader: string | undefined,
  gridRows: string[][],
  scopeRowIndexes: number[] | null,
  httpStatus: number
): ImportOutcome {
  const parts = parseMultipartMixed(raw, contentTypeHeader);
  const serverIssues: CellIssue[] = [];
  const globalIssues: string[] = [];
  // Reasons attributable to a specific rule set, keyed by ruleSetKey
  const reasonsByKey = new Map<string, Set<string>>();
  const addReason = (key: string, reason: string) => {
    const set = reasonsByKey.get(key) ?? new Set<string>();
    set.add(reason);
    reasonsByKey.set(key, set);
  };

  const globalPart = findPart(parts, 'Global-Issue');
  if (globalPart) {
    const lines = globalPart.body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && line.toLowerCase() !== GLOBAL_SENTINEL);
    // The part may be a CSV of per-rule-set errors: RulesetName,FolderPath,Error
    const isErrorCsv = lines.length > 0 && /^rulesetname\s*,\s*folderpath\s*,\s*error$/i.test(lines[0]);
    if (isErrorCsv) {
      const errorRows = parseCsv(lines.slice(1).join('\n'));
      errorRows.forEach((row) => {
        if (row.length < 3) return;
        const [name, folder, error] = row;
        globalIssues.push(`${name.trim()} (${folder.trim()}): ${error.trim()}`);
        addReason(ruleSetKey(folder, name), error.trim());
      });
    } else {
      lines.forEach((line) => {
        globalIssues.push(line);
        serverIssues.push({ ruleId: 'V-01', row: -1, col: null, severity: 'error', source: 'server', message: line });
      });
    }
  }

  const scope = scopeRowIndexes ?? gridRows.map((_, i) => i);
  const scopeKeys = new Map<string, number[]>(); // ruleSetKey → grid rows in scope
  scope.forEach((r) => {
    const key = ruleSetKey(gridRows[r][COL.FOLDER_PATH], gridRows[r][COL.RULESET_NM]);
    const list = scopeKeys.get(key) ?? [];
    list.push(r);
    scopeKeys.set(key, list);
  });

  // Index scope rows by a composite row identity for reason mapping
  const rowIdentity = (row: string[]): string =>
    [
      ruleSetKey(row[COL.FOLDER_PATH], row[COL.RULESET_NM]),
      row[COL.RULE_NM].trim().toLowerCase(),
      row[COL.RULE_SEQ_NO].trim(),
      row[COL.EXPRESSION_TYPE].trim().toUpperCase(),
      row[COL.EXPRESSION_ORDER].trim(),
    ].join('|');
  const identityToRow = new Map<string, number>();
  scope.forEach((r) => {
    const id = rowIdentity(gridRows[r]);
    if (!identityToRow.has(id)) identityToRow.set(id, r);
  });

  let rejectedKeys: string[] = [];
  const rejectedPart = findPart(parts, 'Rejected-csv');
  if (rejectedPart && rejectedPart.body.trim().toLowerCase() !== REJECT_SENTINEL && rejectedPart.body.trim() !== '') {
    const { keys, rows: rejectedRows } = keysFromCsvBody(rejectedPart.body);
    rejectedKeys = keys;

    // Per-row reasons from a 16th column, when present
    rejectedRows.forEach((row) => {
      const reason = row.length > RULE_CSV_COLUMNS.length ? row[RULE_CSV_COLUMNS.length].trim() : '';
      if (reason !== '') {
        const key = row.length > COL.FOLDER_PATH ? ruleSetKey(row[COL.FOLDER_PATH], row[COL.RULESET_NM]) : '';
        if (key !== '') addReason(key, reason);
        const gridRow = identityToRow.get(rowIdentity(row));
        if (gridRow !== undefined) {
          serverIssues.push({ ruleId: 'V-03', row: gridRow, col: null, severity: 'error', source: 'server', message: reason });
        }
      }
    });
  }
  // Rule sets named only in Global-Issue count as rejected too
  for (const key of reasonsByKey.keys()) {
    if (!rejectedKeys.includes(key)) rejectedKeys.push(key);
  }

  // Rule-set-level rejection on every grid row of each rejected rule set
  rejectedKeys.forEach((key) => {
    const gridRowsOfKey = scopeKeys.get(key);
    const reasons = reasonsByKey.get(key);
    const suffix = reasons && reasons.size > 0 ? `: ${Array.from(reasons).join('; ')}` : ' (see the server response for details).';
    const name = gridRowsOfKey !== undefined ? gridRows[gridRowsOfKey[0]][COL.RULESET_NM].trim() : key;
    const anchor = gridRowsOfKey !== undefined ? gridRowsOfKey[0] : -1;
    serverIssues.push({
      ruleId: 'V-02',
      row: anchor,
      col: null,
      severity: 'error',
      source: 'server',
      message: `Rule set "${name}" was rejected by the service${suffix}`,
      ruleSetKey: key,
    });
  });

  let acceptedKeys: string[] = [];
  const acceptedPart = findPart(parts, 'Accepted-csv');
  if (acceptedPart && acceptedPart.body.trim() !== '') {
    acceptedKeys = keysFromCsvBody(acceptedPart.body).keys;
  }
  // Fallback: on a successful import with no usable Accepted part, everything
  // sent and not rejected counts as accepted. Never applied to a 400 response.
  if (acceptedKeys.length === 0 && httpStatus === 201) {
    const rejected = new Set(rejectedKeys);
    acceptedKeys = Array.from(scopeKeys.keys()).filter((key) => !rejected.has(key));
  }

  const rejectedRowIndexes: number[] = [];
  rejectedKeys.forEach((key) => {
    const rowsOfKey = scopeKeys.get(key);
    if (rowsOfKey) rejectedRowIndexes.push(...rowsOfKey);
  });
  rejectedRowIndexes.sort((a, b) => a - b);

  return {
    httpStatus,
    globalIssues,
    acceptedKeys,
    rejectedKeys,
    rejectedRowIndexes,
    serverIssues,
    rawResponse: raw,
    scopeRowIndexes,
    timestamp: Date.now(),
  };
}
