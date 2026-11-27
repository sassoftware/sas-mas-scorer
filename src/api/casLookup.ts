// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FieldOption } from '../types/uiBuilder';
import { SAS_NAME, withCasSession } from './casSession';

/** Where a lookup dropdown reads its options: a loaded CAS table's columns. */
export interface LookupSource {
  caslib: string;
  table: string;
  /** The column whose values are sent. */
  valueColumn: string;
  /** The column shown to the user (default: the value column). */
  labelColumn?: string;
}

/** Most options a lookup reads. */
export const LOOKUP_LIMIT = 1000;

const quoteColumn = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The distinct value / label pairs of a CAS table, sorted by label, read with
 * FedSQL in a short CAS session. The table must be loaded in CAS (a global
 * table); the error says so otherwise.
 */
export async function readLookupOptions(source: LookupSource): Promise<FieldOption[]> {
  if (!SAS_NAME.test(source.caslib) || !SAS_NAME.test(source.table)) {
    throw new Error(`${source.caslib}.${source.table} is not a CAS library and table name a lookup can use.`);
  }
  if (!source.valueColumn) throw new Error('No value column is set.');
  const label = source.labelColumn || source.valueColumn;
  const query = `select distinct ${quoteColumn(source.valueColumn)} as v, ${quoteColumn(label)} as l `
    + `from ${source.caslib}.${source.table} order by 2 limit ${LOOKUP_LIMIT}`;
  const result = await withCasSession(action => action('fedSql.execDirect', { query }));
  const set = result?.results?.['Result Set'];
  const rows: unknown[][] = set?.rows ?? [];
  return rows
    .filter(r => r[0] !== null && r[0] !== undefined && String(r[0]).trim() !== '')
    .map(r => ({ value: r[0], label: r[1] === null || r[1] === undefined ? String(r[0]) : String(r[1]).trim() }));
}
