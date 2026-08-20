// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * businessRules service calls for the CSV rule-set import:
 * - postRulesCsv: POST /businessRules/rules with a raw text/csv body
 *   (the response is multipart/mixed — parsed by utils/rulesImport/multipart.ts)
 * - runPreflight: per rule set, resolve the target folder and check whether
 *   the rule set already exists (import updates existing sets, creates new ones)
 */

import { sasViyaClient } from './client';
import { getFolderByPath, SasFolder } from './folders';
import {
  CellIssue,
  PreflightRuleSetResult,
  PreflightState,
  RuleSetGroup,
} from '../types/rulesImport';
import { COL, IMPORT_TIMEOUT_MS } from '../utils/rulesImport/constants';

export interface RuleSetSummary {
  id: string;
  name: string;
  majorRevision?: number;
  minorRevision?: number;
}

export const postRulesCsv = async (
  csv: string
): Promise<{ raw: string; contentType?: string; status: number }> => {
  const response = await sasViyaClient.post('/businessRules/rules', csv, {
    headers: {
      'Content-Type': 'text/csv',
      Accept: 'multipart/mixed',
    },
    responseType: 'text',
    // Keep the multipart body raw (it starts with "--boundary"), but parse
    // JSON bodies so the shared error interceptor can surface real messages
    // for auth/service failures.
    transformResponse: [
      (data: unknown) => {
        if (typeof data === 'string' && /^\s*[[{]/.test(data)) {
          try {
            return JSON.parse(data);
          } catch {
            return data;
          }
        }
        return data;
      },
    ],
    // The service reports rejected imports as 400 with the same multipart
    // body (e.g. ruleset_id mismatch) — let those resolve so we can parse it.
    validateStatus: (status) => status === 201 || status === 400,
    timeout: IMPORT_TIMEOUT_MS,
  });
  // A 400 with a JSON body is a malformed request, not a rejected import
  if (response.status === 400 && typeof response.data !== 'string') {
    const err = response.data as { message?: string; details?: string[] };
    throw new Error(err.message || err.details?.join(', ') || 'The import request was invalid (400).');
  }
  return {
    raw: String(response.data),
    contentType: response.headers?.['content-type'],
    status: response.status,
  };
};

export const findRuleSets = async (name: string, parentFolderUri?: string): Promise<RuleSetSummary[]> => {
  const escaped = name.replace(/'/g, "''");
  const params: Record<string, string> = { filter: `eq(name,'${escaped}')`, limit: '20' };
  if (parentFolderUri) params.parentFolderUri = parentFolderUri;
  const response = await sasViyaClient.get('/businessRules/ruleSets', {
    params,
    headers: {
      Accept: 'application/vnd.sas.collection+json, application/json',
      'Accept-Item': 'application/vnd.sas.business.rule.set+json',
    },
  });
  return response.data.items ?? [];
};

/** Run async tasks with a small concurrency cap. */
const runPool = async <T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    });
  await Promise.all(workers);
  return results;
};

/**
 * Server pre-flight: for every rule set in the file, determine whether the
 * import will CREATE or UPDATE it, and whether its folder exists.
 * A missing folder is informational — the service creates it automatically.
 * Check failures degrade to action 'unknown' (import stays possible, the
 * confirm dialog treats unknown as potentially-update).
 */
export const runPreflight = async (groups: RuleSetGroup[], signature: string): Promise<PreflightState> => {
  // Resolve each distinct folder path once
  const folderPaths = Array.from(new Set(groups.map((g) => g.folderPath))).filter((p) => p !== '');
  const folderResults = new Map<string, { folder: SasFolder | null; error?: string }>();
  await runPool(folderPaths, 4, async (path) => {
    try {
      const folder = await getFolderByPath(path);
      folderResults.set(path, { folder });
    } catch (err) {
      folderResults.set(path, { folder: null, error: err instanceof Error ? err.message : 'Folder check failed' });
    }
  });

  const results = await runPool(groups, 4, async (group): Promise<PreflightRuleSetResult> => {
    const folderResult = folderResults.get(group.folderPath);
    const base: PreflightRuleSetResult = {
      key: group.key,
      name: group.name,
      folderPath: group.folderPath,
      action: 'unknown',
      folderExists: folderResult?.error ? null : (folderResult?.folder ? true : false),
      folderId: folderResult?.folder?.id,
    };

    if (folderResult?.error) {
      return { ...base, checkError: folderResult.error };
    }
    // Folder missing → the rule set cannot exist there yet
    if (!folderResult?.folder) {
      return { ...base, action: 'create' };
    }
    try {
      const matches = await findRuleSets(group.name, `/folders/folders/${folderResult.folder.id}`);
      if (matches.length === 0) return { ...base, action: 'create' };
      const first = matches[0];
      return {
        ...base,
        action: 'update',
        existingRuleSetId: first.id,
        existingRevision:
          first.majorRevision !== undefined ? `${first.majorRevision}.${first.minorRevision ?? 0}` : undefined,
        checkError: matches.length > 1 ? `${matches.length} rule sets with this name exist in the folder` : undefined,
      };
    } catch (err) {
      return { ...base, checkError: err instanceof Error ? err.message : 'Rule set check failed' };
    }
  });

  // Build preflight issues anchored to each group's first row
  const issues: CellIssue[] = [];
  results.forEach((result) => {
    const group = groups.find((g) => g.key === result.key);
    if (!group) return;
    const anchor = group.rowIndexes[0];
    if (result.action === 'update') {
      const rev = result.existingRevision ? ` (revision ${result.existingRevision})` : '';
      issues.push({
        ruleId: 'P-01', row: anchor, col: COL.RULESET_NM, severity: 'info', source: 'preflight',
        message: `Rule set exists${rev} — import will update it with a new revision.`, ruleSetKey: result.key,
      });
      if (result.checkError) {
        issues.push({
          ruleId: 'P-05', row: anchor, col: COL.RULESET_NM, severity: 'warning', source: 'preflight',
          message: `${result.checkError} — the update target is ambiguous.`, ruleSetKey: result.key,
        });
      }
    } else if (result.action === 'create') {
      issues.push({
        ruleId: 'P-02', row: anchor, col: COL.RULESET_NM, severity: 'info', source: 'preflight',
        message: 'Rule set not found on the server — import will create it.', ruleSetKey: result.key,
      });
    } else {
      issues.push({
        ruleId: 'P-04', row: anchor, col: COL.RULESET_NM, severity: 'warning', source: 'preflight',
        message: `Could not check this rule set on the server: ${result.checkError ?? 'unknown error'}.`, ruleSetKey: result.key,
      });
    }
    if (result.folderExists === false) {
      issues.push({
        ruleId: 'P-03', row: anchor, col: COL.FOLDER_PATH, severity: 'warning', source: 'preflight',
        message: `Folder "${result.folderPath}" does not exist — the import will create it automatically.`, ruleSetKey: result.key,
      });
    }
  });

  return { results, issues, forSignature: signature, timestamp: Date.now() };
};
