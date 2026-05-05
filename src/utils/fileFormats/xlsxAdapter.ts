// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FileFormatAdapter, ParsedTable } from './types';

// The `read-excel-file` runtime supports `{ getSheets: true }` and `{ sheet }`
// options, but its published TS types don't expose them. Shim the overloads
// we use.
interface SheetInfo { name: string }
type ReadXlsxFn = {
  (file: File, opts: { getSheets: true }): Promise<SheetInfo[]>;
  (file: File, opts: { sheet: string | number }): Promise<unknown[][]>;
  (file: File): Promise<unknown[][]>;
};

let loader: Promise<ReadXlsxFn> | null = null;
const loadReader = (): Promise<ReadXlsxFn> => {
  if (!loader) {
    loader = import('read-excel-file').then(
      mod => mod.default as unknown as ReadXlsxFn
    );
  }
  return loader;
};

export const xlsxAdapter: FileFormatAdapter = {
  id: 'xlsx',
  label: 'Excel',
  extensions: ['.xlsx'],
  async parse(file, options): Promise<ParsedTable> {
    const readXlsxFile = await loadReader();

    const sheets = await readXlsxFile(file, { getSheets: true });
    const sheetNames = sheets.map(s => s.name);

    const targetSheet = options?.sheetName ?? sheetNames[0];
    const matrix = await readXlsxFile(file, { sheet: targetSheet });

    if (!matrix || matrix.length === 0) {
      return { headers: [], rows: [], sheetNames, activeSheet: targetSheet };
    }

    const headers = matrix[0].map(cell => cell === null || cell === undefined ? '' : String(cell));
    const rows = matrix.slice(1);

    return { headers, rows, sheetNames, activeSheet: targetSheet };
  },
};
