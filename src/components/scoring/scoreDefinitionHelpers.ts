// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared by the three scoring Save dialogs (Save as Scenario, Save Batch
// Scenarios, Save as Test). Each used to carry its own copy of these helpers,
// and the localStorage ones were unguarded: where storage access throws
// (blocked site data, some VA iframe embeds, private modes) opening a dialog
// threw during render and the error boundary replaced the scoring view.

import { ScoreDefinitionMapping } from '../../api/scoreDefinitions';
import { DecisionSignatureVariable } from '../../api/modules';
import { StepParameter, Variable } from '../../types';

// --- localStorage helpers (best-effort: a blocked store just remembers nothing) ---

const STORAGE_PREFIX = 'mas-scenario:';

export const loadPref = (key: string): string | null => {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
};

export const savePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    /* storage blocked or full: the selection is simply not remembered */
  }
};

// --- Mapping helpers ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

export function formatMappingValue(value: unknown): unknown {
  // Return null (not undefined) so the key survives JSON.stringify
  if (value === null || value === undefined) return null;

  // Booleans and numbers pass through
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;

  // Strings: detect date/datetime patterns
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return { type: 'date', value };
    if (DATETIME_RE.test(value)) return { type: 'datetime', value };
    return value;
  }

  // Objects/arrays: JSON-stringify for datagrids or complex types
  if (typeof value === 'object') {
    // Already wrapped date/datetime objects pass through
    if ('type' in (value as Record<string, unknown>) && 'value' in (value as Record<string, unknown>)) {
      return value;
    }
    return JSON.stringify(value);
  }

  return value;
}

/**
 * Build a case-insensitive lookup from MAS variable names to the original
 * decision variable names. MAS lowercases and appends a trailing '_' to
 * variable names when publishing a decision (e.g. "Cylinders" → "cylinders_").
 *
 * The lookup tries two matches against each signature variable:
 *   1. Exact case-insensitive match (masName vs sigName)
 *   2. Case-insensitive match after stripping trailing '_' from the MAS name
 */
export function buildNameLookup(signature: DecisionSignatureVariable[]): (masName: string) => string {
  // Map lowercase decision name → original decision name
  const lowerToOriginal = new Map<string, string>();
  for (const v of signature) {
    lowerToOriginal.set(v.name.toLowerCase(), v.name);
  }

  return (masName: string): string => {
    // Try exact case-insensitive match first
    const direct = lowerToOriginal.get(masName.toLowerCase());
    if (direct) return direct;

    // Try after stripping trailing '_' (MAS suffix)
    if (masName.endsWith('_')) {
      const stripped = masName.slice(0, -1);
      const matched = lowerToOriginal.get(stripped.toLowerCase());
      if (matched) return matched;
    }

    // Fallback: return as-is (strip trailing '_' at minimum)
    return masName.endsWith('_') ? masName.slice(0, -1) : masName;
  };
}

/**
 * Scenario mappings for one scored row: the inputs that were sent as 'static'
 * mappings and the outputs they produced as 'expected' ones. The two must come
 * from the same run — callers pass the inputs captured with the result, never
 * the live form state.
 */
export function buildScenarioMappings(
  inputValues: Record<string, unknown>,
  inputParameters: StepParameter[],
  outputValues: Variable[],
  resolveName: (masName: string) => string
): ScoreDefinitionMapping[] {
  const mappings: ScoreDefinitionMapping[] = [];

  for (const param of inputParameters) {
    mappings.push({
      variableName: resolveName(param.name),
      mappingType: 'static',
      mappingValue: formatMappingValue(inputValues[param.name]),
    });
  }

  for (const variable of outputValues) {
    mappings.push({
      variableName: resolveName(variable.name),
      mappingType: 'expected',
      mappingValue: formatMappingValue(variable.value),
    });
  }

  return mappings;
}

// --- Name validation ---

const NAME_INVALID_CHARS = /[/{}]/;

export function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required';
  if (name.length > 100) return 'Name must be 100 characters or less';
  if (NAME_INVALID_CHARS.test(name)) return 'Name cannot contain /, {, or } characters';
  return null;
}
