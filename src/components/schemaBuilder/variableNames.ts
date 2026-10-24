// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Checks the variable names of the Schema → Code mapping before code is
// generated or saved. Every name becomes both a Python local in execute() and a
// SAS Intelligent Decisioning signature term, so it must be a valid, unique
// Python identifier that does not clash with what the generated code uses.

import type { VariableMapping } from '../../types/schemaBuilder';
import { DS2_RESERVED } from '../../utils/rulesImport/constants';
import { GENERATED_PY_NAMES, GENERATED_PY_PREFIX } from '../../utils/schemaCodegen';

const MAX_NAME_LENGTH = 32;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Python hard keywords (soft keywords such as `match`/`type` are valid names). */
const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

/** Fixed outputs every generated execute() returns. */
const FIXED_OUTPUTS = ['parse_success', 'parse_status'];

export interface NameCheck {
  /** Blocks Generate / Save: the code would not compile or would misbehave. */
  error?: string;
  /** Allowed, but may be rejected later by SAS Intelligent Decisioning. */
  warning?: string;
}

export interface NameCheckResult {
  /** One entry per mapping, in mapping order. */
  rows: NameCheck[];
  input: NameCheck;
  /** Number of names with a blocking error (rows + input). */
  errorCount: number;
  /** A sentence explaining why Generate / Save are disabled, or null. */
  blockedReason: string | null;
}

/** Checks that do not depend on the other names. */
function checkOwnName(name: string): NameCheck {
  if (name === '') return { error: 'Name is required' };
  if (name.length > MAX_NAME_LENGTH) return { error: `Max ${MAX_NAME_LENGTH} characters` };
  if (!NAME_RE.test(name)) {
    return { error: 'Use letters, digits and _ only, not starting with a digit' };
  }
  if (PYTHON_KEYWORDS.has(name)) return { error: `"${name}" is a Python keyword` };
  if (name.startsWith(GENERATED_PY_PREFIX)) {
    return { error: `Names starting with ${GENERATED_PY_PREFIX} are reserved for the generated code` };
  }
  if (GENERATED_PY_NAMES.has(name) && !FIXED_OUTPUTS.includes(name)) {
    return { error: `"${name}" is used by the generated code` };
  }
  if (DS2_RESERVED.has(name.toUpperCase())) {
    return { warning: `"${name}" is a DS2 reserved word; SAS Intelligent Decisioning may reject it` };
  }
  return {};
}

export function checkVariableNames(mappings: VariableMapping[], inputVarName: string): NameCheckResult {
  const input = checkOwnName(inputVarName);
  if (!input.error && FIXED_OUTPUTS.includes(inputVarName.toLowerCase())) {
    input.error = `"${inputVarName}" is one of the fixed outputs`;
  }

  // First row index of each lower-cased name (SID names are case-insensitive).
  const firstIndex = new Map<string, number>();
  mappings.forEach((m, i) => {
    const key = m.variableName.toLowerCase();
    if (!firstIndex.has(key)) firstIndex.set(key, i);
  });

  const rows = mappings.map((m, i): NameCheck => {
    const own = checkOwnName(m.variableName);
    if (own.error) return own;
    const key = m.variableName.toLowerCase();
    if (FIXED_OUTPUTS.includes(key)) return { error: `Clashes with the fixed ${key} output` };
    if (key === inputVarName.toLowerCase()) return { error: 'Same as the input variable name' };
    const first = firstIndex.get(key) ?? i;
    if (first !== i) return { error: `Duplicate of row ${first + 1} (names are case-insensitive)` };
    if (mappings.some((o, j) => j > i && o.variableName.toLowerCase() === key)) {
      return { error: 'Used again further down (names are case-insensitive)' };
    }
    return own;
  });

  const errorCount = rows.filter(r => r.error).length + (input.error ? 1 : 0);
  let blockedReason: string | null = null;
  if (input.error) {
    blockedReason = `Fix the input variable name in step 1 first: ${input.error}.`;
  } else if (errorCount > 0) {
    blockedReason = `Fix ${errorCount} invalid variable name${errorCount === 1 ? '' : 's'} in step 2 first.`;
  }
  return { rows, input, errorCount, blockedReason };
}
