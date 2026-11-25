// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Module } from '../types';
import { getDecisionRevision } from './decisions';

/** What a decision declares a parameter as, when it is more than MAS says. */
export type DecisionKind = 'date' | 'datetime' | 'checkbox';

/** Which of a module's parameters are SAS dates, datetimes or booleans, by lowercase name. */
export type DateKinds = Record<string, DecisionKind>;

// One lookup per module; a failed one is not kept, so the next asks again.
const cache = new Map<string, Promise<DateKinds>>();

/**
 * MAS reports a decision's date, datetime and boolean variables as plain decimals, but
 * the module records the decision revision it was published from
 * (properties.sourceURI), and that revision's signature has the real types.
 * Modules that did not come from a decision (or a decision that can't be
 * read) give an empty answer: the app author then chooses the widget.
 */
export function getDecisionDateKinds(module: Module): Promise<DateKinds> {
  const key = module.id.toLowerCase();
  let pending = cache.get(key);
  if (pending) return pending;
  const source = module.properties?.find(p => p.name === 'sourceURI')?.value ?? '';
  if (!source.startsWith('/decisions/flows/')) return Promise.resolve({});
  pending = getDecisionRevision(source)
    .then(flow => {
      const kinds: DateKinds = {};
      for (const v of flow.signature ?? []) {
        const type = v.dataType?.toLowerCase();
        // A boolean reaches MAS as a decimal that takes 1 and 0 (tested:
        // JSON true and "Y" are rejected), so it gets the Checkbox.
        const kind: DecisionKind | null =
          type === 'date' || type === 'datetime' ? type : type === 'boolean' ? 'checkbox' : null;
        if (!kind) continue;
        const name = v.name.toLowerCase();
        kinds[name] = kind;
        // A module published from SAS Intelligent Decisioning's own UI names
        // its inputs with a trailing underscore (credit_score_).
        kinds[`${name}_`] = kind;
      }
      return kinds;
    })
    .catch(() => {
      cache.delete(key);
      return {};
    });
  cache.set(key, pending);
  return pending;
}

/** A decision DataGrid's declared columns and row limit. */
export interface GridSchema {
  columns: { name: string; dataType: string }[];
  maxRows: number | null;
}

const gridCache = new Map<string, Promise<Record<string, GridSchema>>>();

/**
 * The columns (dataGridExtension) and row limit (dataGridMaxRowCount) of each
 * DataGrid input of the decision a module was published from, by lowercase
 * name (with the trailing-underscore spelling too). Empty for other modules,
 * for grids the decision declares no columns for, or when it can't be read.
 */
export function getDecisionGridSchemas(module: Module): Promise<Record<string, GridSchema>> {
  const key = module.id.toLowerCase();
  let pending = gridCache.get(key);
  if (pending) return pending;
  const source = module.properties?.find(p => p.name === 'sourceURI')?.value ?? '';
  if (!source.startsWith('/decisions/flows/')) return Promise.resolve({});
  pending = getDecisionRevision(source)
    .then(flow => {
      const out: Record<string, GridSchema> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const v of (flow.signature ?? []) as any[]) {
        if (String(v.dataType).toLowerCase() !== 'datagrid' || v.direction === 'output') continue;
        const cols = Array.isArray(v.dataGridExtension) ? v.dataGridExtension : [];
        if (cols.length === 0) continue;
        const schema: GridSchema = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns: cols.map((c: any) => ({ name: String(c.name), dataType: String(c.dataType ?? 'string') })),
          maxRows: typeof v.dataGridMaxRowCount === 'number' && v.dataGridMaxRowCount > 0 ? v.dataGridMaxRowCount : null,
        };
        const name = String(v.name).toLowerCase();
        out[name] = schema;
        out[`${name}_`] = schema;
      }
      return out;
    })
    .catch(() => {
      gridCache.delete(key);
      return {};
    });
  gridCache.set(key, pending);
  return pending;
}
