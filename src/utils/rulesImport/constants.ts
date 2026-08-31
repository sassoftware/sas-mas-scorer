// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { RuleCsvColumn } from '../../types/rulesImport';

/** Canonical column indexes (matches RULE_CSV_COLUMNS order). */
export const COL = {
  RULESET_ID: 0,
  RULESET_NM: 1,
  FOLDER_PATH: 2,
  RULESET_DESC: 3,
  RULE_ID: 4,
  RULE_NM: 5,
  RULE_DESC: 6,
  RULE_SEQ_NO: 7,
  CONDITIONAL: 8,
  RECORD_RULE_FIRED_FLAG: 9,
  DATATYPE: 10,
  LHS_TERM: 11,
  EXPRESSION: 12,
  EXPRESSION_TYPE: 13,
  EXPRESSION_ORDER: 14,
} as const;

/** Maximum lengths per column, from the %DCM_IMPORT_RULESET informats. */
export const MAX_LEN: Record<RuleCsvColumn, number> = {
  ruleset_id: 36,
  ruleset_nm: 100,
  folder_path: 4000,
  ruleset_desc: 256,
  rule_id: 36,
  rule_nm: 100,
  rule_desc: 256,
  rule_seq_no: 32,
  conditional: 10,
  record_rule_fired_flag: 1,
  datatype: 15,
  lhs_term: 32,
  expression: 4000,
  expression_type: 9,
  expression_order: 32,
};

/** 'or' chains an additional condition onto the preceding rule (seen in real exports). */
export const CONDITIONALS = ['if', 'elseif', 'else', 'or'] as const;

/** Valid signature-term data types (businessRules OpenAPI signatureTerm enum, minus service-only 'any'). */
export const DATATYPES = ['string', 'decimal', 'integer', 'date', 'datetime', 'datagrid', 'boolean'] as const;

/** Display casing for the datatype select. */
export const DATATYPE_DISPLAY = ['string', 'decimal', 'integer', 'date', 'datetime', 'dataGrid', 'boolean'] as const;

export const EXPRESSION_TYPES = ['CONDITION', 'ACTION', 'ACTIONADVANCEDLIST'] as const;

/** Expression types that carry an action rather than a condition. */
export const ACTION_TYPES: ReadonlySet<string> = new Set(['ACTION', 'ACTIONADVANCEDLIST']);

export const FLAG_VALUES = ['Y', 'N'] as const;

export const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Valid rule-set term name: letter/underscore start, alphanumerics + underscore, max 32. */
export const LHS_TERM_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/**
 * DS2 reserved words (SAS DS2 Programmer's Guide, "Reserved Words in the DS2
 * Language") — terms may not use them as names. Compared uppercase.
 * _N_ is additionally disallowed by SAS Intelligent Decisioning.
 */
export const DS2_RESERVED = new Set<string>([
  '__KPLIST', '_ALL_', '_HOSTNAME_', '_NEW_', '_NTHREADS_', '_NULL_', '_RC_',
  '_ROWSET_', '_TEMPORARY_', '_THREADID_', 'ABORT', 'AND', 'AS', 'ASM',
  'BIGINT', 'BINARY', 'BY', 'CALL', 'CATALOG', 'CHAR', 'CHARACTER', 'COMMIT',
  'CONTINUE', 'DATA', 'DATE', 'DCL', 'DECIMAL', 'DECLARE', 'DELETE',
  'DESCENDING', 'DIM', 'DO', 'DOUBLE', 'DROP', 'DS2_OPTIONS', 'ELIF', 'ELSE',
  'END', 'ENDDATA', 'ENDMODULE', 'ENDPACKAGE', 'ENDSTAGE', 'ENDTABLE',
  'ENDTHREAD', 'EQ', 'ERROR', 'ESCAPE', 'FLOAT', 'FORMAT', 'FORTRAN',
  'FORWARD', 'FROM', 'FUNCTION', 'GE', 'GLOBAL', 'GOTO', 'GROUP', 'GT',
  'HAVING', 'IDENTITY', 'IF', 'IN', 'INDSNAME', 'INDSNUM', 'INFORMAT',
  'INLINE', 'INPUT', 'INT', 'INTEGER', 'IN_OUT', 'KEEP', 'LABEL', 'LE',
  'LEAVE', 'LIKE', 'LIST', 'LT', 'MERGE', 'METHOD', 'MISSING', 'MODIFY',
  'MODULE', 'NATIONAL', 'NCHAR', 'NE', 'NG', 'NL', 'NOT', 'NULL', 'NUMERIC',
  'NVARCHAR', 'ODS', 'OF', 'OR', 'ORDER', 'OTHER', 'OTHERWISE', 'OUTPUT',
  'OVERWRITE', 'PACKAGE', 'PARTITION', 'PRECISION', 'PRIVATE', 'PROGRAM',
  'PUT', 'REAL', 'REMOVE', 'RENAME', 'REPLACE', 'REQUIRE', 'RETAIN', 'RETURN',
  'RETURNS', 'ROLLBACK', 'SELECT', 'SET', 'SMALLINT', 'SQLSUB', 'STAGE',
  'STOP', 'STORED', 'SUBSTR', 'SYSTEM', 'TABLE', 'THEN', 'THIS', 'THREAD',
  'THREADS', 'TIME', 'TIMESTAMP', 'TINYINT', 'TO', 'TRANSACTION', 'T_UDF',
  'TSPL_OPTIONS', 'UNTIL', 'UPDATE', 'VARARRAY', 'VARBINARY', 'VARCHAR',
  'VARLIST', 'VARYING', 'WHEN', 'WHERE', 'WHILE',
]);

/** Boundary observed in the importRules multipart response, used when the header lacks one. */
export const FALLBACK_BOUNDARY = '_001_002_003_004_005_006_007_008_009_010_011_012_';

export const ROWS_PER_PAGE = 200;
export const LARGE_FILE_WARN_ROWS = 2000;
export const IMPORT_TIMEOUT_MS = 300000;
