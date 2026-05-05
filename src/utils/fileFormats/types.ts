// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export interface ParsedTable {
  headers: string[];
  rows: unknown[][];
  sheetNames?: string[];
  activeSheet?: string;
}

export interface FileFormatAdapter {
  id: string;
  label: string;
  extensions: string[];
  // For delimited text formats, exposes the default delimiter so the UI can
  // offer a "change delimiter" control without re-detecting the format.
  defaultDelimiter?: string;
  parse(file: File, options?: ParseOptions): Promise<ParsedTable>;
}

export interface ParseOptions {
  sheetName?: string;
  delimiter?: string;
}
