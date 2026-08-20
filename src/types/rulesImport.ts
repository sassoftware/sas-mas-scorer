// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared types for the Business Rules CSV import feature.
 * CSV format reference: SAS Intelligent Decisioning %DCM_IMPORT_RULESET
 * ("Format of Rule Set CSV Input File") and the businessRules OpenAPI spec.
 */

/** Canonical column order of the rule-set CSV. Grid columns use these indexes. */
export const RULE_CSV_COLUMNS = [
  'ruleset_id',
  'ruleset_nm',
  'folder_path',
  'ruleset_desc',
  'rule_id',
  'rule_nm',
  'rule_desc',
  'rule_seq_no',
  'conditional',
  'record_rule_fired_flag',
  'datatype',
  'lhs_term',
  'expression',
  'expression_type',
  'expression_order',
] as const;

export type RuleCsvColumn = (typeof RULE_CSV_COLUMNS)[number];

export type IssueSeverity = 'error' | 'warning' | 'info';

/** Where an issue came from — the three sources have different lifecycles. */
export type IssueSource = 'client' | 'preflight' | 'server';

export interface CellIssue {
  /** Rule id from the validation inventory, e.g. 'C-04', 'P-01', 'V-02'. */
  ruleId: string;
  /** 0-based grid data-row index; -1 for file/global-level issues. */
  row: number;
  /** Canonical column index; null = whole row / rule set level. */
  col: number | null;
  severity: IssueSeverity;
  source: IssueSource;
  message: string;
  /** Group anchor for rule-set-level issues. */
  ruleSetKey?: string;
}

/** Rows of one rule set (grouped by normalized folder path + name). */
export interface RuleSetGroup {
  key: string;
  /** Display name (first occurrence casing). */
  name: string;
  folderPath: string;
  /** Grid rows belonging to this rule set, in file order. */
  rowIndexes: number[];
  ruleCount: number;
  /** First non-empty ruleset_id in the group (null when blank). */
  rulesetId: string | null;
}

export interface HeaderMapResult {
  ok: boolean;
  /** File column index per canonical column index; -1 if missing. */
  colMap: number[];
  missing: RuleCsvColumn[];
  /** Unknown header names (their columns are dropped from the grid). */
  extras: string[];
  /** True when a 16th rejection-reason column from a downloaded reject file was found. */
  hasReasonColumn: boolean;
  issues: CellIssue[];
}

export type PreflightAction = 'create' | 'update' | 'unknown';

export interface PreflightRuleSetResult {
  key: string;
  name: string;
  folderPath: string;
  action: PreflightAction;
  existingRuleSetId?: string;
  /** "major.minor" of the existing rule set, for the confirm dialog. */
  existingRevision?: string;
  /** null = the folder check itself failed. */
  folderExists: boolean | null;
  folderId?: string;
  checkError?: string;
}

export interface PreflightState {
  results: PreflightRuleSetResult[];
  issues: CellIssue[];
  /** Signature of the rule-set groups the checks ran against — staleness detection. */
  forSignature: string;
  timestamp: number;
}

export interface MultipartPart {
  contentId: string;
  contentType?: string;
  body: string;
}

export interface ImportOutcome {
  /** HTTP status of the import response (201 success, 400 rejected). */
  httpStatus: number;
  /** Global-Issue lines (sentinel "No global errors." filtered out). */
  globalIssues: string[];
  acceptedKeys: string[];
  rejectedKeys: string[];
  /** Grid rows belonging to rejected rule sets — the retry scope. */
  rejectedRowIndexes: number[];
  serverIssues: CellIssue[];
  /** Raw multipart body, downloadable for debugging. */
  rawResponse: string;
  /** Grid rows that were sent (null = all rows). */
  scopeRowIndexes: number[] | null;
  timestamp: number;
}

export type ImportPhase =
  | 'empty'
  | 'editing'
  | 'preflighting'
  | 'ready'
  | 'confirming'
  | 'importing'
  | 'imported';
