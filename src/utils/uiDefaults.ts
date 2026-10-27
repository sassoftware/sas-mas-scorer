// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Step, StepParameter, StepParameterType } from '../types';
import {
  UIDefinition,
  UIField,
  UISection,
  UISettings,
  WidgetType,
} from '../types/uiBuilder';

let counter = 0;
function generateId(): string {
  return `${Date.now()}-${++counter}`;
}

/**
 * Map a step parameter type to its default widget.
 */
export function getDefaultWidget(type: StepParameterType, direction: 'input' | 'output'): WidgetType {
  if (direction === 'output') {
    if (type === 'decimal') return 'gauge';
    if (type === 'string') return 'badge';
    return 'readonly';
  }

  switch (type) {
    case 'decimal':
    case 'integer':
    case 'bigint':
      return 'number';
    case 'string':
      return 'text';
    case 'binary':
    case 'decimalArray':
    case 'integerArray':
    case 'bigintArray':
    case 'stringArray':
    case 'binaryArray':
      return 'textarea';
    default:
      return 'text';
  }
}

/**
 * Get compatible widgets for a parameter type and direction.
 */
export function getCompatibleWidgets(type: StepParameterType, direction: 'input' | 'output'): WidgetType[] {
  if (direction === 'output') {
    if (type === 'decimal' || type === 'integer' || type === 'bigint') {
      return ['readonly', 'gauge', 'badge', 'hidden'];
    }
    if (type === 'string') {
      return ['readonly', 'badge', 'hidden'];
    }
    return ['readonly', 'hidden'];
  }

  switch (type) {
    case 'decimal':
      return ['number', 'slider', 'dropdown', 'text', 'readonly', 'hidden'];
    case 'integer':
    case 'bigint':
      // Toggle sends 1/0 by default; a decimal flag is rare enough to leave out.
      return ['number', 'slider', 'dropdown', 'radio', 'toggle', 'text', 'readonly', 'hidden'];
    case 'string':
      // Toggle sends configurable on/off codes ("Y"/"N" by default).
      return ['text', 'dropdown', 'radio', 'toggle', 'textarea', 'readonly', 'hidden'];
    case 'binary':
      return ['textarea', 'readonly', 'hidden'];
    default:
      // Array types
      return ['textarea', 'readonly', 'hidden'];
  }
}

/**
 * A new field for a step parameter, with the type's default widget. Used for
 * a generated layout and for fields added later (Add field, signature re-sync).
 */
export function createFieldForParameter(param: StepParameter, direction: 'input' | 'output', order: number): UIField {
  return {
    parameterId: param.name,
    direction,
    label: param.name,
    widget: getDefaultWidget(param.type, direction),
    visible: true,
    order,
    width: param.type.endsWith('Array') || param.type === 'binary' ? 'full' : 'half',
    placeholder: direction === 'input' ? `Enter ${param.name}` : undefined,
  };
}

/**
 * Generate a default UIDefinition from a step's schema.
 */
export function generateDefaultUI(
  moduleId: string,
  step: Step,
  name?: string
): UIDefinition {
  const inputFields: UIField[] = (step.inputs ?? []).map((p, i) =>
    createFieldForParameter(p, 'input', i)
  );
  const outputFields: UIField[] = (step.outputs ?? []).map((p, i) =>
    createFieldForParameter(p, 'output', i)
  );

  const sections: UISection[] = [];

  if (inputFields.length > 0) {
    sections.push({
      id: generateId(),
      title: 'Inputs',
      fields: inputFields,
    });
  }

  if (outputFields.length > 0) {
    sections.push({
      id: generateId(),
      title: 'Results',
      fields: outputFields,
    });
  }

  const settings: UISettings = {
    submitLabel: step.id.toLowerCase().startsWith('execute') ? 'Execute' : 'Score',
    showExecutionTime: true,
    theme: 'default',
    outputLayout: 'below',
  };

  const now = new Date().toISOString();

  return {
    id: generateId(),
    name: name ?? `${moduleId} UI`,
    moduleId,
    stepId: step.id,
    createdAt: now,
    updatedAt: now,
    layout: {
      columns: 2,
      sections,
    },
    settings,
  };
}

// --- Values by parameter type -------------------------------------------
//
// One conversion for everything a UI App sends: the widgets keep what the
// user typed (so "3." or "1, 2," survive while typing), and the runner
// converts by the parameter type in the step signature just before the
// request. Strings stay strings ("007" is not 7), numbers are parsed (comma
// or dot decimal mark), and array parameters go out as arrays.

const NUMERIC_TYPES = new Set<string>(['decimal', 'integer', 'bigint']);
const NUMERIC_ARRAY_TYPES = new Set<string>(['decimalArray', 'integerArray', 'bigintArray']);

export function isNumericType(type: string | undefined): boolean {
  return type !== undefined && NUMERIC_TYPES.has(type);
}

export function isIntegerType(type: string | undefined): boolean {
  return type === 'integer' || type === 'bigint' || type === 'integerArray' || type === 'bigintArray';
}

export function isArrayType(type: string | undefined): boolean {
  return type !== undefined && type.endsWith('Array');
}

/**
 * Strict number parse: the whole text must be a number, with "." or "," as
 * the decimal mark. Returns null for blank text and NaN for anything else,
 * so a typo is reported rather than half-read ("12abc" is not 12).
 */
export function parseNumberText(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const normalized = /^[^.,]*,[^.,]*$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

/**
 * Comma-separated text to an array for an array parameter. Same rules as the
 * Scoring page's array input: blank or "null" items are null, and numeric
 * arrays turn unreadable items into null (the runner's pre-run check reports
 * those before a run).
 */
export function parseArrayValue(
  rawValue: string,
  type: StepParameterType
): (number | string | null)[] {
  const items = rawValue.split(',').map((item) => item.trim());

  if (NUMERIC_ARRAY_TYPES.has(type)) {
    return items.map((item) => {
      if (item === '' || item.toLowerCase() === 'null') return null;
      const num = Number(item);
      return isNaN(num) ? null : num;
    });
  }

  return items.map((item) => (item === '' ? null : item));
}

/** Empty for the purpose of "Required": null, blank text, or an empty array. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Convert a form value to the JSON shape the step signature's type calls for.
 * Unknown types (a datagrid, or no signature at all) pass through unchanged.
 * Text that does not read as a number is returned as it is; the pre-run check
 * reports it before a run.
 */
export function convertValueForType(value: unknown, type: string | undefined): unknown {
  if (value === undefined || value === null) return null;
  if (!type) return value;

  if (NUMERIC_TYPES.has(type)) {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
      const num = parseNumberText(value);
      if (num === null) return null;
      return Number.isNaN(num) ? value : num;
    }
    return value;
  }

  if (type === 'string') {
    if (typeof value === 'string') return value === '' ? null : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return value;
  }

  if (type.endsWith('Array')) {
    const elementType = type.slice(0, -'Array'.length);
    if (Array.isArray(value)) {
      return value.map((v) => convertValueForType(v, elementType));
    }
    if (typeof value === 'string') {
      return value.trim() === '' ? null : parseArrayValue(value, type as StepParameterType);
    }
    return [convertValueForType(value, elementType)];
  }

  return value;
}

/**
 * A value typed into the builder (an option value, a default) stored the way
 * the parameter's type needs it: a number for a numeric parameter when it
 * reads as one, the text as typed otherwise. An unknown parameter keeps the
 * text; the runner converts again by type before sending.
 */
export function coerceConfigValue(raw: string, type: string | undefined): unknown {
  if (isNumericType(type)) {
    const num = parseNumberText(raw);
    if (num !== null && !Number.isNaN(num)) return num;
  }
  return raw;
}

/** Default on/off values a Toggle sends, by parameter type. */
export function getDefaultToggleValues(type: string | undefined): { on: string; off: string } {
  return type === 'string' ? { on: 'Y', off: 'N' } : { on: '1', off: '0' };
}

/** What a Toggle sends when on and off, by parameter type and field settings. */
export function getToggleValues(field: UIField, type: string | undefined): { on: unknown; off: unknown } {
  const v = field.validation;
  const defaults = getDefaultToggleValues(type);
  const on = v?.onValue !== undefined && v.onValue !== '' ? v.onValue : defaults.on;
  const off = v?.offValue !== undefined && v.offValue !== '' ? v.offValue : defaults.off;
  if (type === 'string') return { on, off };
  // Numeric parameter, or no signature (the pre-2.12 behaviour: 1 / 0).
  const onNum = parseNumberText(on);
  const offNum = parseNumberText(off);
  return {
    on: onNum !== null && !Number.isNaN(onNum) ? onNum : 1,
    off: offNum !== null && !Number.isNaN(offNum) ? offNum : 0,
  };
}

/** The step parameter a field is bound to: exact name first, then any case. */
export function findParameter(params: StepParameter[], name: string): StepParameter | undefined {
  return params.find((p) => p.name === name)
    ?? params.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Longest text the field accepts: the author's Max length, else the size the
 * step signature declares for a string parameter. Undefined means no limit.
 */
export function getEffectiveMaxLength(field: UIField, param: StepParameter | undefined): number | undefined {
  const configured = field.validation?.maxLength;
  if (configured !== undefined && configured > 0) return configured;
  if (param?.type === 'string' && param.size && param.size > 0) return param.size;
  return undefined;
}

/**
 * Initial form values for a run: each input's default, plus the minimum a
 * slider shows, so what is on screen is what is sent even when the user never
 * touches the control. (A toggle's "off" depends on the parameter type, which
 * is known only once the step loads; resolveInputValue fills it in.)
 */
export function getInitialInputValues(definition: UIDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const section of definition.layout.sections) {
    for (const field of section.fields) {
      if (field.direction !== 'input') continue;
      if (field.defaultValue !== undefined) {
        values[field.parameterId] = field.defaultValue;
      } else if (field.widget === 'slider') {
        values[field.parameterId] = field.validation?.min ?? 0;
      }
    }
  }
  return values;
}

/**
 * The value an input field holds for a run: what the form has, else its
 * default, else what the control shows untouched (a slider's minimum, a
 * toggle's "off").
 */
export function resolveInputValue(
  field: UIField,
  param: StepParameter | undefined,
  values: Record<string, unknown>
): unknown {
  if (field.parameterId in values) return values[field.parameterId];
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.widget === 'slider') return field.validation?.min ?? 0;
  if (field.widget === 'toggle') return getToggleValues(field, param?.type).off;
  return undefined;
}

/**
 * The values to send for a run, keyed by the step's own input names and
 * converted by type. Only fields bound to a current step input are sent; a
 * field whose parameter the step no longer has is left out.
 */
export function buildRunValues(
  definition: UIDefinition,
  step: Step,
  values: Record<string, unknown>
): Record<string, unknown> {
  const inputs = step.inputs ?? [];
  const run: Record<string, unknown> = {};
  for (const section of definition.layout.sections) {
    for (const field of section.fields) {
      if (field.direction !== 'input') continue;
      const param = findParameter(inputs, field.parameterId);
      if (!param) continue;
      run[param.name] = convertValueForType(resolveInputValue(field, param, values), param.type);
    }
  }
  return run;
}

// --- Signature drift ----------------------------------------------------

export interface OrphanedField {
  sectionId: string;
  field: UIField;
}

export interface SignatureDrift {
  /** Step inputs no field is bound to (sent as missing, i.e. null). */
  newInputs: StepParameter[];
  /** Step outputs no field shows. */
  newOutputs: StepParameter[];
  /** Parameter fields whose parameter the step signature no longer lists. */
  orphaned: OrphanedField[];
}

/**
 * Compare the definition's stored parameter fields with the step's current
 * signature (its inputs and outputs). Names match case-insensitively, as the
 * runner already does for outputs. Call it only with a loaded step: without
 * one every field would look orphaned.
 */
export function computeSignatureDrift(definition: UIDefinition, step: Step): SignatureDrift {
  const inputs = step.inputs ?? [];
  const outputs = step.outputs ?? [];
  const all = [...inputs, ...outputs];
  const used = new Set<string>();
  const orphaned: OrphanedField[] = [];

  for (const section of definition.layout.sections) {
    for (const field of section.fields) {
      if (field.direction === 'static') continue;
      const param = findParameter(all, field.parameterId);
      if (param) used.add(param.name);
      else orphaned.push({ sectionId: section.id, field });
    }
  }

  return {
    newInputs: inputs.filter((p) => !used.has(p.name)),
    newOutputs: outputs.filter((p) => !used.has(p.name)),
    orphaned,
  };
}

export function hasSignatureDrift(drift: SignatureDrift | null): drift is SignatureDrift {
  return !!drift && (drift.newInputs.length + drift.newOutputs.length + drift.orphaned.length) > 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 new inputs, 1 new output, 1 removed parameter" */
export function describeSignatureDrift(drift: SignatureDrift): string {
  const parts: string[] = [];
  if (drift.newInputs.length) parts.push(plural(drift.newInputs.length, 'new input'));
  if (drift.newOutputs.length) parts.push(plural(drift.newOutputs.length, 'new output'));
  if (drift.orphaned.length) parts.push(plural(drift.orphaned.length, 'removed parameter'));
  return parts.join(', ');
}
