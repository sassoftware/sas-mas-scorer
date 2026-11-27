// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { UIDefinition, UIField } from '../types/uiBuilder';
import { resultValue, ruleMatches } from './messageRules';

const allFields = (def: Pick<UIDefinition, 'layout'>): UIField[] => def.layout.sections.flatMap(s => s.fields);

/**
 * Whether a field's "Show only when" condition holds. The other field's value
 * is the input as entered (or its default), or the result MAS returned.
 * A field without a condition, or whose condition names a field that is
 * gone, is shown.
 */
export function conditionHolds(
  field: UIField,
  def: Pick<UIDefinition, 'layout'>,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown> = {}
): boolean {
  const cond = field.showWhen;
  if (!cond?.field) return true;
  const other = allFields(def).find(f => f.parameterId === cond.field);
  if (!other) return true;
  const value = other.direction === 'input'
    ? (other.parameterId in inputs ? inputs[other.parameterId] : other.defaultValue)
    : resultValue(outputs, other.parameterId);
  const probe = { x: value as unknown };
  if (cond.op === 'present') {
    return !ruleMatches({ id: '', result: 'x', op: 'missing', message: 'x', tone: 'info' }, probe);
  }
  return ruleMatches({ id: '', result: 'x', op: cond.op, value: cond.value, value2: cond.value2, message: 'x', tone: 'info' }, probe);
}

export const describeCondition = (def: Pick<UIDefinition, 'layout'>, field: UIField): string | null => {
  const c = field.showWhen;
  if (!c?.field) return null;
  const other = allFields(def).find(f => f.parameterId === c.field);
  const name = other?.label ?? c.field;
  const op = { eq: 'is', ne: 'is not', gt: 'is above', lt: 'is below', between: 'is between', missing: 'is missing', present: 'has a value' }[c.op];
  const val = c.op === 'missing' || c.op === 'present' ? '' : c.op === 'between' ? ` ${c.value ?? ''} and ${c.value2 ?? ''}` : ` ${c.value ?? ''}`;
  return `shown when ${name} ${op}${val}`;
};
