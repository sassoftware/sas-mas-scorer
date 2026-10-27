// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pre-run check for a UI App's inputs. It checks only what the app can know:
 * the type and size the MAS step signature declares, and what the author set
 * on the field (Required, Min, Max, Max length). It says nothing about whether
 * the module will accept a value; the module's own rules run in MAS.
 */

import { Step, StepParameter } from '../../types';
import { FieldErrors, UIDefinition, UIField } from '../../types/uiBuilder';
import {
  findParameter,
  getEffectiveMaxLength,
  isArrayType,
  isEmptyValue,
  isIntegerType,
  isNumericType,
  parseNumberText,
  resolveInputValue,
} from '../../utils/uiDefaults';

/** Widgets the user cannot edit: nothing to correct, so nothing to check. */
const UNCHECKED_WIDGETS = new Set(['hidden', 'readonly', 'markdown']);

const formatNumber = (n: number) => String(n);

function checkNumber(field: UIField, param: StepParameter | undefined, value: unknown): string | null {
  const num = typeof value === 'number' ? value
    : typeof value === 'string' ? parseNumberText(value)
      : NaN;
  if (num === null) return null;
  const declared = param ? ` The step signature declares this input as ${param.type}.` : '';
  if (Number.isNaN(num)) return `Enter a number.${declared}`;
  if (isIntegerType(param?.type) && !Number.isInteger(num)) {
    return `Enter a whole number.${declared}`;
  }
  const { min, max } = field.validation ?? {};
  if (min !== undefined && max !== undefined && (num < min || num > max)) {
    return `Enter a value from ${formatNumber(min)} to ${formatNumber(max)}.`;
  }
  if (min !== undefined && num < min) return `Enter ${formatNumber(min)} or more.`;
  if (max !== undefined && num > max) return `Enter ${formatNumber(max)} or less.`;
  return null;
}

function checkNumericArray(param: StepParameter, value: unknown): string | null {
  const items = Array.isArray(value)
    ? value.map((v) => (v === null || v === undefined ? '' : String(v)))
    : String(value).split(',').map((s) => s.trim());
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === '' || item.toLowerCase() === 'null') continue;
    const num = Number(item);
    if (!Number.isFinite(num)) {
      return `Item ${i + 1} ("${item}") is not a number. The step signature declares this input as ${param.type}.`;
    }
    if (isIntegerType(param.type) && !Number.isInteger(num)) {
      return `Item ${i + 1} (${item}) is not a whole number. The step signature declares this input as ${param.type}.`;
    }
  }
  return null;
}

/** The problem with one input's current value, or null. */
export function validateFieldValue(
  field: UIField,
  param: StepParameter | undefined,
  value: unknown
): string | null {
  if (field.direction !== 'input' || !field.visible || UNCHECKED_WIDGETS.has(field.widget)) return null;

  if (isEmptyValue(value)) {
    if (!field.validation?.required) return null;
    return field.widget === 'dropdown' || field.widget === 'radio'
      ? 'Required. Choose an option.'
      : 'Required. Enter a value.';
  }

  const type = param?.type;
  if (isNumericType(type) || (!param && (field.widget === 'number' || field.widget === 'slider'))) {
    return checkNumber(field, param, value);
  }

  if (param && isArrayType(type) && type !== 'stringArray' && type !== 'binaryArray') {
    return checkNumericArray(param, value);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const maxLength = getEffectiveMaxLength(field, param);
    const length = String(value).length;
    if (maxLength !== undefined && length > maxLength) {
      const fromSignature = field.validation?.maxLength === undefined;
      return `Use at most ${maxLength} characters (now ${length}).${
        fromSignature ? ' That is the size the step signature declares for this input.' : ''
      }`;
    }
  }

  return null;
}

/**
 * Check every input field. Keys are field parameter ids. A field bound to a
 * parameter the step signature no longer lists is skipped: it is not sent,
 * so it must not block a run.
 */
export function validateInputs(
  definition: UIDefinition,
  step: Step | null,
  values: Record<string, unknown>
): FieldErrors {
  const inputs = step?.inputs ?? [];
  const errors: FieldErrors = {};
  for (const section of definition.layout.sections) {
    for (const field of section.fields) {
      if (field.direction !== 'input') continue;
      const param = findParameter(inputs, field.parameterId);
      if (step && !param) continue;
      const message = validateFieldValue(field, param, resolveInputValue(field, param, values));
      if (message) errors[field.parameterId] = message;
    }
  }
  return errors;
}
