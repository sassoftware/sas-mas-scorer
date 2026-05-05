// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FileFormatAdapter, ParsedTable } from './types';

let loader: Promise<typeof import('hyparquet')> | null = null;
const loadReader = () => {
  if (!loader) {
    loader = import('hyparquet');
  }
  return loader;
};

// hyparquet returns BigInt for 64-bit ints; convert to Number when safe so
// downstream consumers don't have to special-case bigints.
const normalize = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  return value;
};

export const parquetAdapter: FileFormatAdapter = {
  id: 'parquet',
  label: 'Parquet',
  extensions: ['.parquet'],
  async parse(file): Promise<ParsedTable> {
    const { parquetReadObjects, parquetMetadata } = await loadReader();

    const buffer = await file.arrayBuffer();

    const metadata = parquetMetadata(buffer);
    const schemaFields = metadata.schema.slice(1);
    const headers = schemaFields.map(f => f.name);

    const records = await parquetReadObjects({ file: buffer });

    const rows: unknown[][] = records.map(rec => {
      const obj = rec as Record<string, unknown>;
      return headers.map(h => normalize(obj[h]));
    });

    return { headers, rows };
  },
};
