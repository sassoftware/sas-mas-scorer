// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { MessageRule } from '../types/uiBuilder';

/** Missing as SAS and MAS return it: null, empty, or a SAS missing value (".", ".A"–".Z", "._"). */
const isMissing = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && /^\s*(\.[A-Z_]?)?\s*$/i.test(v));

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

/** The returned value for a result name, matched without case (MAS may change the case). */
export function resultValue(outputs: Record<string, unknown>, name: string): unknown {
  if (name in outputs) return outputs[name];
  const key = Object.keys(outputs).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : outputs[key];
}

/**
 * Whether a rule matches what MAS returned. It only compares the returned
 * value with the author's value: numbers as numbers when both sides are
 * numbers, otherwise text exactly (after trimming). Nothing is inferred.
 */
export function ruleMatches(rule: MessageRule, outputs: Record<string, unknown>): boolean {
  const v = resultValue(outputs, rule.result);
  if (rule.op === 'missing') return isMissing(v);
  if (isMissing(v)) return false;
  const n = asNumber(v);
  const a = asNumber(rule.value);
  switch (rule.op) {
    case 'eq':
      return n !== null && a !== null ? n === a : String(v).trim() === String(rule.value ?? '').trim();
    case 'ne':
      return n !== null && a !== null ? n !== a : String(v).trim() !== String(rule.value ?? '').trim();
    case 'gt':
      return n !== null && a !== null && n > a;
    case 'lt':
      return n !== null && a !== null && n < a;
    case 'between': {
      const b = asNumber(rule.value2);
      return n !== null && a !== null && b !== null && n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    default:
      return false;
  }
}

/** Every rule that matches, in the author's order. */
export function matchingMessages(rules: MessageRule[] | undefined, outputs: Record<string, unknown>): MessageRule[] {
  if (!rules?.length || Object.keys(outputs).length === 0) return [];
  return rules.filter(r => r.result && r.message.trim() && ruleMatches(r, outputs));
}

export const RULE_OPS: { value: MessageRule['op']; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'does not equal' },
  { value: 'gt', label: 'is above' },
  { value: 'lt', label: 'is below' },
  { value: 'between', label: 'is between' },
  { value: 'missing', label: 'is missing' },
];
