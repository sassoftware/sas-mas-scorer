// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { FileFormatAdapter } from './types';
import { csvAdapter, tsvAdapter } from './delimitedAdapter';
import { jsonlAdapter } from './jsonlAdapter';
import { xlsxAdapter } from './xlsxAdapter';
import { parquetAdapter } from './parquetAdapter';

export const adapters: FileFormatAdapter[] = [
  csvAdapter,
  tsvAdapter,
  jsonlAdapter,
  xlsxAdapter,
  parquetAdapter,
];

export const findAdapter = (filename: string): FileFormatAdapter | undefined => {
  const lower = filename.toLowerCase();
  return adapters.find(a => a.extensions.some(ext => lower.endsWith(ext)));
};

export const acceptAttribute = (): string =>
  adapters.flatMap(a => a.extensions).join(',');

export { convertValue } from './convert';
export * from './types';
