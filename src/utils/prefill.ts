// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { UIDefinition, UIField } from '../types/uiBuilder';
import { sasDateFromIso, sasDatetimeFromIso } from './sasDate';
import { getDefaultToggleValues } from './uiDefaults';

/** Query parameters the app link uses itself; never taken as input values. */
const RESERVED = new Set(['def', 'standalone']);

/** Inputs a link can fill: not hidden, not a file or a DataGrid. */
export const prefillableFields = (def: UIDefinition): UIField[] =>
  def.layout.sections.flatMap(s => s.fields).filter(f =>
    f.direction === 'input' && f.visible && f.widget !== 'file' && f.widget !== 'datagrid' && f.widget !== 'hidden');

/** A link value as the form holds it: dates as SAS values, checkboxes as their on/off values. */
function formValue(field: UIField, raw: string, paramType?: string): unknown {
  const t = raw.trim();
  if (field.widget === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return sasDateFromIso(t);
  if (field.widget === 'datetime' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return sasDatetimeFromIso(t.replace(' ', 'T'));
  if (field.widget === 'checkbox' || field.widget === 'toggle') {
    const d = getDefaultToggleValues(paramType);
    const on = field.validation?.onValue || d.on;
    const off = field.validation?.offValue || d.off;
    if (/^(true|yes|on)$/i.test(t)) return paramType === 'string' ? on : Number(on);
    if (/^(false|no|off)$/i.test(t)) return paramType === 'string' ? off : Number(off);
  }
  return raw;
}

/**
 * Input values from the app link's query (?income=50000&start=2026-11-24),
 * matched to input names without regard to case. Only fills the form: the
 * app never runs on its own.
 */
export function prefillFromQuery(
  def: UIDefinition,
  search: string,
  paramTypes: Record<string, string | undefined> = {}
): { values: Record<string, unknown>; names: string[] } {
  const params = new URLSearchParams(search);
  const byLower = new Map<string, string>();
  params.forEach((v, k) => { if (!RESERVED.has(k.toLowerCase())) byLower.set(k.toLowerCase(), v); });
  const values: Record<string, unknown> = {};
  const names: string[] = [];
  for (const f of prefillableFields(def)) {
    const raw = byLower.get(f.parameterId.toLowerCase());
    if (raw === undefined) continue;
    values[f.parameterId] = formValue(f, raw, paramTypes[f.parameterId.toLowerCase()]);
    names.push(f.label);
  }
  return { values, names };
}

/** "&income=50000&start=2026-11-24" for the Share dialog. */
export function prefillQuery(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, v]) => v.trim() !== '')
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('');
}
