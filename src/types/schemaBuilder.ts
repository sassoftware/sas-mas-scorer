// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Types for the Schema → Code page: parsing a sample JSON/XML payload into
// SAS Intelligent Decisioning variable mappings.

export type SasDataType =
  | 'Character'
  | 'Integer'
  | 'Decimal'
  | 'Boolean'
  | 'Date'
  | 'Datetime'
  | 'DataGrid';

export interface VariableMapping {
  /** Original path in the source schema (e.g. "invoice.subtotal" or "Application/@Channel") */
  sourcePath: string;
  /** Generated SAS variable name (max 32 chars) */
  variableName: string;
  /** Inferred SAS Intelligent Decisioning data type */
  dataType: SasDataType;
  /** Storage length for string-like types (Character/Date/Datetime). */
  length?: number;
  /** Sample value from the input, if available */
  sampleValue?: string;
  /** Whether this is an array/repeating element that maps to a DataGrid */
  isArray: boolean;
  /** For DataGrid: child column definitions */
  dataGridColumns?: DataGridColumn[];
}

export interface DataGridColumn {
  name: string;
  dataType: 'Character' | 'Integer' | 'Decimal';
  sourcePath: string;
}

export type InputFormat = 'json' | 'xml' | 'unknown';
