// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Turning a saved SID score definition back into what the scorer works with:
// decision variable names back to MAS parameter names, and stored mapping
// values back to plain values. Shared by Load Scenario (static inputs and
// expected outputs) and Load Test (datasource mappings).

import { DecisionSignatureVariable } from '../../api/modules';
import { ScoreDefinitionMapping } from '../../api/scoreDefinitions';
import { StepParameter } from '../../types';
import { coerceDatagridValue } from '../../utils/datagrid';

/**
 * Build a reverse name lookup: decision variable name → MAS parameter name.
 *
 * The save flow maps MAS names → decision names (stripping trailing _ and matching
 * case-insensitively). Loading reverses this: we need to map the decision variable
 * names stored in the score definition back to the MAS parameter names.
 */
export function buildReverseNameLookup(
  signature: DecisionSignatureVariable[],
  masParams: StepParameter[]
): (decisionName: string) => string | null {
  // Build decision name (lowercased) → MAS param name
  const decisionToMas = new Map<string, string>();

  for (const masParam of masParams) {
    const masLower = masParam.name.toLowerCase();

    // Try exact match against signature
    const exactMatch = signature.find(s => s.name.toLowerCase() === masLower);
    if (exactMatch) {
      decisionToMas.set(exactMatch.name.toLowerCase(), masParam.name);
      continue;
    }

    // Try after stripping trailing _ from MAS name
    if (masParam.name.endsWith('_')) {
      const stripped = masParam.name.slice(0, -1).toLowerCase();
      const strippedMatch = signature.find(s => s.name.toLowerCase() === stripped);
      if (strippedMatch) {
        decisionToMas.set(strippedMatch.name.toLowerCase(), masParam.name);
        continue;
      }
    }

    // Fallback: map the MAS name to itself (lowercase key)
    decisionToMas.set(masLower, masParam.name);
  }

  return (decisionName: string): string | null => {
    // Try direct lookup
    const direct = decisionToMas.get(decisionName.toLowerCase());
    if (direct) return direct;

    // Try appending _ (reverse of the stripping logic)
    const withSuffix = decisionToMas.get(decisionName.toLowerCase() + '_');
    if (withSuffix) return withSuffix;

    return null;
  };
}

/**
 * Unwrap a mapping value back to a plain JS value suitable for InputForm.
 */
export function unwrapMappingValue(value: unknown, paramType: string): unknown {
  if (value === null || value === undefined) return null;

  // Wrapped date/datetime objects → plain string
  if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
    return (value as { value: unknown }).value;
  }

  // JSON-stringified datagrids → parse back to the native array MAS expects
  const grid = coerceDatagridValue(value);
  if (grid) return grid;

  // JSON-stringified objects for datagrid types → parse back
  if (typeof value === 'string' && paramType.endsWith('Array')) {
    try {
      return JSON.parse(value);
    } catch {
      // Not JSON, return as-is
    }
  }

  return value;
}

/** A scenario as the scorer uses it. */
export interface LoadedScenario {
  /** Every MAS input of the step: the scenario's value, or null when it has none */
  values: Record<string, unknown>;
  /** MAS output name → the stored expected value (null: nothing expected) */
  expected: Record<string, unknown>;
  /** Scenario inputs (decision names) that are not inputs of this step, so they cannot be sent */
  unmatchedInputs: string[];
}

/**
 * The inputs and expected outputs of a scenario's mappings, under MAS names.
 * Every input of the step gets a value (null when the scenario has none), so
 * loading it replaces the form rather than merging into it. Expected values
 * are kept as stored; the comparison unwraps them.
 */
export function scenarioFromMappings(
  mappings: ScoreDefinitionMapping[],
  signature: DecisionSignatureVariable[],
  inputParameters: StepParameter[],
  outputParameters: StepParameter[]
): LoadedScenario {
  const resolveInput = buildReverseNameLookup(signature, inputParameters);
  const resolveOutput = buildReverseNameLookup(signature, outputParameters);
  const typeOf = new Map(inputParameters.map(p => [p.name, p.type] as const));

  const values: Record<string, unknown> = {};
  for (const p of inputParameters) values[p.name] = null;
  const expected: Record<string, unknown> = {};
  const unmatchedInputs: string[] = [];

  for (const mapping of mappings) {
    if (mapping.mappingType === 'static') {
      const name = resolveInput(mapping.variableName);
      if (!name) {
        unmatchedInputs.push(mapping.variableName);
        continue;
      }
      values[name] = unwrapMappingValue(mapping.mappingValue, typeOf.get(name) ?? 'string');
    } else if (mapping.mappingType === 'expected') {
      // An in/out variable is both an input and an output of the step; its
      // expected value is checked against the output.
      const name = resolveOutput(mapping.variableName) ?? mapping.variableName;
      expected[name] = mapping.mappingValue ?? null;
    }
  }
  return { values, expected, unmatchedInputs };
}

/** Why a scenario cannot be run on this step, or null when all its inputs fit. */
export function scenarioMismatch(loaded: LoadedScenario, stepId: string): string | null {
  const names = loaded.unmatchedInputs;
  if (names.length === 0) return null;
  const list = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
  return `${names.length === 1 ? 'Its input' : `${names.length} of its inputs`} (${list}) ${names.length === 1 ? 'is' : 'are'} not ${names.length === 1 ? 'an input' : 'inputs'} of step “${stepId}”. It may belong to another step of this module, or the decision has changed since it was saved.`;
}
