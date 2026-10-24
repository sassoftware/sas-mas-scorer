// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Where each MAS input gets its value in a batch run: a column of the file or
// CAS table, "missing" (null on every row) or a constant. Shared by the file
// upload and the CAS table paths.
//
// "Missing" is an explicit choice, distinct from "not chosen yet": the
// auto-mapper leaves unmatched inputs unset, and a run needs every input to
// have a source, so nothing is silently sent as null.

import { StepParameter } from '../../types';
import {
  ConversionReport,
  ValueIssue,
  convertCell,
  describeDateConversion,
} from '../../utils/fileFormats';

export type InputSource =
  | { kind: 'unset' }
  | { kind: 'column'; column: string }
  | { kind: 'missing' }
  | { kind: 'constant'; text: string };

export type InputSources = Record<string, InputSource>;

const UNSET: InputSource = { kind: 'unset' };

export const sourceOf = (sources: InputSources, name: string): InputSource =>
  sources[name] ?? UNSET;

const normalizeName = (name: string): string => name.toLowerCase().replace(/[_\s-]/g, '');

/**
 * Match column names to inputs: exact (ignoring case, '_', '-' and blanks)
 * first, then containment either way. Unmatched inputs stay unset.
 */
export const autoMapColumns = (
  columnNames: string[],
  parameters: StepParameter[]
): InputSources => {
  const sources: InputSources = {};
  const normalizedColumns = columnNames.map(normalizeName);

  parameters.forEach(param => {
    const normalizedParam = normalizeName(param.name);

    let matchIndex = normalizedColumns.findIndex(h => h === normalizedParam);
    if (matchIndex === -1) {
      matchIndex = normalizedColumns.findIndex(h =>
        h.includes(normalizedParam) || normalizedParam.includes(h)
      );
    }

    sources[param.name] = matchIndex !== -1
      ? { kind: 'column', column: columnNames[matchIndex] }
      : UNSET;
  });

  return sources;
};

export interface ConstantCheck {
  value: unknown;
  error: string | null;
}

/** Convert a typed constant to the input's type, or say why it cannot be used. */
export const checkConstant = (param: StepParameter, text: string): ConstantCheck => {
  if (text.trim() === '') return { value: null, error: 'Enter a value' };
  const result = convertCell(text, param.type);
  if (result.unparseable) {
    const isArray = param.type.endsWith('Array');
    return {
      value: null,
      error: isArray
        ? `Not a list of ${param.type.replace('Array', '')} values (separate with ;)`
        : `Not a valid ${param.type} value`,
    };
  }
  return { value: result.value, error: null };
};

export interface MappingSummary {
  mapped: number;
  missing: number;
  constant: number;
  unset: number;
  /** Inputs whose constant cannot be converted */
  invalidConstants: string[];
  /** Every input has a source and every constant is valid */
  ready: boolean;
}

export const summarizeSources = (
  parameters: StepParameter[],
  sources: InputSources
): MappingSummary => {
  const summary: MappingSummary = {
    mapped: 0, missing: 0, constant: 0, unset: 0, invalidConstants: [], ready: false,
  };
  for (const param of parameters) {
    const source = sourceOf(sources, param.name);
    switch (source.kind) {
      case 'column': summary.mapped++; break;
      case 'missing': summary.missing++; break;
      case 'constant':
        summary.constant++;
        if (checkConstant(param, source.text).error) summary.invalidConstants.push(param.name);
        break;
      default: summary.unset++;
    }
  }
  summary.ready = summary.unset === 0 && summary.invalidConstants.length === 0;
  return summary;
};

/** "12 mapped, 3 missing, 1 constant" (+ ", 2 not set") */
export const describeSummary = (summary: MappingSummary): string => {
  const parts = [`${summary.mapped} mapped`];
  if (summary.missing) parts.push(`${summary.missing} missing`);
  if (summary.constant) parts.push(`${summary.constant} constant`);
  if (summary.unset) parts.push(`${summary.unset} not set`);
  return parts.join(', ');
};

/**
 * The values of the inputs that do not come from a column: null for
 * "missing", the converted constant otherwise. Set on every row.
 */
export const fixedInputValues = (
  parameters: StepParameter[],
  sources: InputSources
): Record<string, unknown> => {
  const fixed: Record<string, unknown> = {};
  for (const param of parameters) {
    const source = sourceOf(sources, param.name);
    if (source.kind === 'missing') fixed[param.name] = null;
    else if (source.kind === 'constant') fixed[param.name] = checkConstant(param, source.text).value;
  }
  return fixed;
};

/** Input → column name, null for every input not read from a column. */
export const columnMappingsOf = (
  parameters: StepParameter[],
  sources: InputSources
): Record<string, string | null> => {
  const mappings: Record<string, string | null> = {};
  for (const param of parameters) {
    const source = sourceOf(sources, param.name);
    mappings[param.name] = source.kind === 'column' ? source.column : null;
  }
  return mappings;
};

/** Every unset input becomes "missing"; chosen sources are kept. */
export const unsetToMissing = (
  parameters: StepParameter[],
  sources: InputSources
): InputSources => {
  const next: InputSources = { ...sources };
  for (const param of parameters) {
    if (sourceOf(sources, param.name).kind === 'unset') next[param.name] = { kind: 'missing' };
  }
  return next;
};

// --- Pre-flight notes ---

export interface MappingNote {
  tone: 'warning' | 'info';
  text: string;
}

const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** '37 values in column INCOME can't be read as decimal (e.g. "N/A", "1,5"; first in row 12)' */
export const describeIssue = (issue: ValueIssue): string => {
  const examples = issue.examples.map(e => `"${e}"`).join(', ');
  return `${plural(issue.count, 'value')} in column ${issue.column} can't be read as ${issue.type}` +
    ` (e.g. ${examples}; first in row ${issue.firstRow.toLocaleString()})`;
};

/** Per-input notes for the mapping grid from a conversion report. */
export const notesFromReport = (report: ConversionReport): Record<string, MappingNote[]> => {
  const notes: Record<string, MappingNote[]> = {};
  const add = (input: string, note: MappingNote) => {
    notes[input] = [...(notes[input] ?? []), note];
  };
  for (const issue of report.issues) {
    add(issue.input, {
      tone: 'warning',
      text: `${describeIssue(issue)}. They are sent as missing (null), not 0.`,
    });
  }
  for (const date of report.dates) {
    add(date.input, {
      tone: 'info',
      text: `${plural(date.count, 'date')} in column ${date.column} are sent as ${describeDateConversion(date.conversion)}.`,
    });
  }
  return notes;
};

/** Merge note maps (e.g. type conflicts and preview findings). */
export const mergeNotes = (
  ...maps: Record<string, MappingNote[]>[]
): Record<string, MappingNote[]> => {
  const merged: Record<string, MappingNote[]> = {};
  for (const map of maps) {
    for (const [input, list] of Object.entries(map)) {
      merged[input] = [...(merged[input] ?? []), ...list];
    }
  }
  return merged;
};
