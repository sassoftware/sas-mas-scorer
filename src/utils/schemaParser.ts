// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Parses a sample JSON or XML payload into SAS Intelligent Decisioning variable
// mappings, inferring data types and detecting repeating elements as DataGrids.

import type { InputFormat, VariableMapping, SasDataType, DataGridColumn } from '../types/schemaBuilder';

const MAX_VAR_LENGTH = 32;

/** Detect whether input is JSON or XML */
export function detectFormat(input: string): InputFormat {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  return 'unknown';
}

/** Infer SAS data type from a string value */
export function inferType(value: string | null | undefined): SasDataType {
  if (value === null || value === undefined || value === '') return 'Character';
  const v = value.trim();

  // Boolean
  if (/^(true|false)$/i.test(v)) return 'Boolean';

  // Datetime: 2025-10-09T16:04:56 or with timezone
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return 'Datetime';

  // Date: 2025-10-09 or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Date';

  // Integer
  if ((/^-?\d+$/.test(v) && !v.startsWith('0')) || v === '0') return 'Integer';

  // Decimal
  if (/^-?\d+\.\d+$/.test(v)) return 'Decimal';

  return 'Character';
}

/** Suggest a storage length for string-like SAS ID types. */
export function defaultLength(dataType: SasDataType, sampleValue?: string): number | undefined {
  const sampleLen = sampleValue?.trim().length ?? 0;
  switch (dataType) {
    case 'Character': return Math.max(32, sampleLen);
    case 'Date': return 10;       // YYYY-MM-DD
    case 'Datetime': return 26;   // YYYY-MM-DDTHH:MM:SS.ffffff
    default: return undefined;    // numeric / boolean / datagrid carry no char length
  }
}

/** Sanitize a name for SAS: only [A-Za-z0-9_], start with letter/underscore */
function sanitizeName(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (s.length > 0 && /^[0-9]/.test(s)) s = '_' + s;
  return s;
}

/** Build a variable name from path segments, truncating to 32 chars smartly */
export function buildVariableName(segments: string[]): string {
  const sanitized = segments.map(sanitizeName);
  let name = sanitized.join('_');

  if (name.length <= MAX_VAR_LENGTH) return name;

  // Strategy: abbreviate earlier segments, keep last segment intact
  const last = sanitized[sanitized.length - 1];
  if (last.length >= MAX_VAR_LENGTH) {
    return last.substring(0, MAX_VAR_LENGTH);
  }

  // Try progressively shorter prefixes for earlier segments
  const remaining = MAX_VAR_LENGTH - last.length - 1; // 1 for underscore
  const prefixParts = sanitized.slice(0, -1);

  // Take first N chars of each prefix part
  const charsPerPart = Math.max(1, Math.floor(remaining / prefixParts.length));
  const abbreviated = prefixParts.map(p => p.substring(0, charsPerPart));
  name = [...abbreviated, last].join('_');

  if (name.length <= MAX_VAR_LENGTH) return name;

  // Final fallback: just use last part with a hash prefix
  return name.substring(0, MAX_VAR_LENGTH);
}

/** Ensure variable names are unique */
function deduplicateNames(mappings: VariableMapping[]): VariableMapping[] {
  const seen = new Map<string, number>();
  return mappings.map(m => {
    const lower = m.variableName.toLowerCase();
    const count = seen.get(lower) ?? 0;
    seen.set(lower, count + 1);
    if (count > 0) {
      const suffix = `_${count}`;
      const maxBase = MAX_VAR_LENGTH - suffix.length;
      return {
        ...m,
        variableName: m.variableName.substring(0, maxBase) + suffix,
      };
    }
    return m;
  });
}

// ─── JSON Parsing ───────────────────────────────────────────────

interface FlatField {
  path: string[];
  value: string;
  isArray: boolean;
  arrayItems?: Record<string, string>[];
}

function flattenJson(obj: unknown, path: string[] = []): FlatField[] {
  const fields: FlatField[] = [];

  if (Array.isArray(obj)) {
    // This is an array — treat as DataGrid
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      const items = obj.map(item => {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          flat[k] = String(v ?? '');
        }
        return flat;
      });
      fields.push({ path, value: '', isArray: true, arrayItems: items });
    }
    return fields;
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      fields.push(...flattenJson(value, [...path, key]));
    }
    return fields;
  }

  fields.push({ path, value: String(obj ?? ''), isArray: false });
  return fields;
}

export function parseJson(input: string): VariableMapping[] {
  const parsed = JSON.parse(input);
  const fields = flattenJson(parsed);

  const mappings: VariableMapping[] = fields.map(f => {
    if (f.isArray && f.arrayItems) {
      const allKeys = new Set<string>();
      f.arrayItems.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));

      const columns: DataGridColumn[] = [...allKeys].map(k => {
        const sampleVal = f.arrayItems!.find(item => item[k])![k] ?? '';
        const dt = inferType(sampleVal);
        return {
          name: sanitizeName(k).substring(0, MAX_VAR_LENGTH),
          dataType: dt === 'Boolean' || dt === 'Date' || dt === 'Datetime' ? 'Character' : dt as 'Character' | 'Integer' | 'Decimal',
          sourcePath: k,
        };
      });

      return {
        sourcePath: f.path.join('.'),
        variableName: buildVariableName(f.path),
        dataType: 'DataGrid' as SasDataType,
        sampleValue: `[${f.arrayItems.length} items]`,
        isArray: true,
        dataGridColumns: columns,
      };
    }

    const dt = inferType(f.value);
    return {
      sourcePath: f.path.join('.'),
      variableName: buildVariableName(f.path),
      dataType: dt,
      length: defaultLength(dt, f.value),
      sampleValue: f.value,
      isArray: false,
    };
  });

  return deduplicateNames(mappings);
}

// ─── XML Parsing ────────────────────────────────────────────────

interface XmlField {
  path: string[];
  value: string;
  isArray: boolean;
  isAttribute: boolean;
  arrayElements?: Element[];
}

function getChildElements(el: Element): Element[] {
  return Array.from(el.children);
}

function detectRepeating(el: Element): Map<string, Element[]> {
  const tagCounts = new Map<string, Element[]>();
  for (const child of getChildElements(el)) {
    const tag = child.tagName;
    const existing = tagCounts.get(tag) ?? [];
    existing.push(child);
    tagCounts.set(tag, existing);
  }
  return tagCounts;
}

function flattenXml(el: Element, path: string[], parentRepeatingTags?: Set<string>): XmlField[] {
  const fields: XmlField[] = [];

  // Collect attributes
  for (const attr of Array.from(el.attributes)) {
    fields.push({
      path: [...path, attr.name],
      value: attr.value,
      isArray: false,
      isAttribute: true,
    });
  }

  const children = getChildElements(el);

  if (children.length === 0) {
    // Leaf element — get text content
    const text = el.textContent?.trim() ?? '';
    if (el.attributes.length === 0 && path.length > 0) {
      fields.push({
        path,
        value: text,
        isArray: false,
        isAttribute: false,
      });
    }
    return fields;
  }

  // Detect repeating child elements
  const tagGroups = detectRepeating(el);

  for (const [tag, elements] of tagGroups) {
    if (elements.length > 1 || parentRepeatingTags?.has(tag)) {
      // Repeating element — this becomes a DataGrid
      fields.push({
        path: [...path, tag],
        value: '',
        isArray: true,
        isAttribute: false,
        arrayElements: elements,
      });
    } else {
      // Single child — recurse
      fields.push(...flattenXml(elements[0], [...path, tag]));
    }
  }

  return fields;
}

function extractDataGridColumnsFromElements(elements: Element[]): DataGridColumn[] {
  const columnMap = new Map<string, { values: string[]; isAttribute: boolean }>();

  for (const el of elements) {
    // Attributes
    for (const attr of Array.from(el.attributes)) {
      const existing = columnMap.get(attr.name);
      if (existing) {
        existing.values.push(attr.value);
      } else {
        columnMap.set(attr.name, { values: [attr.value], isAttribute: true });
      }
    }
    // Child text elements
    for (const child of getChildElements(el)) {
      if (getChildElements(child).length === 0) {
        const val = child.textContent?.trim() ?? '';
        const existing = columnMap.get(child.tagName);
        if (existing) {
          existing.values.push(val);
        } else {
          columnMap.set(child.tagName, { values: [val], isAttribute: false });
        }
      }
    }
  }

  return [...columnMap.entries()].map(([name, { values }]) => {
    const sampleVal = values.find(v => v !== '') ?? '';
    const dt = inferType(sampleVal);
    return {
      name: sanitizeName(name).substring(0, MAX_VAR_LENGTH),
      dataType: dt === 'Boolean' || dt === 'Date' || dt === 'Datetime' ? 'Character' : dt as 'Character' | 'Integer' | 'Decimal',
      sourcePath: name,
    };
  });
}

export function parseXml(input: string): VariableMapping[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/xml');
  const root = doc.documentElement;

  if (root.tagName === 'parsererror') {
    throw new Error('Invalid XML: ' + root.textContent);
  }

  const fields = flattenXml(root, [root.tagName]);

  const mappings: VariableMapping[] = fields.map(f => {
    if (f.isArray && f.arrayElements) {
      const columns = extractDataGridColumnsFromElements(f.arrayElements);
      return {
        sourcePath: f.path.join('/'),
        variableName: buildVariableName(f.path),
        dataType: 'DataGrid' as SasDataType,
        sampleValue: `[${f.arrayElements.length} elements]`,
        isArray: true,
        dataGridColumns: columns,
      };
    }

    const dt = inferType(f.value);
    return {
      sourcePath: f.path.join('/'),
      variableName: buildVariableName(f.path),
      dataType: dt,
      length: defaultLength(dt, f.value),
      sampleValue: f.value,
      isArray: false,
    };
  });

  return deduplicateNames(mappings);
}

/** Main entry point: detect format and parse */
export function parseInput(input: string): { format: InputFormat; mappings: VariableMapping[] } {
  const format = detectFormat(input);
  if (format === 'json') return { format, mappings: parseJson(input) };
  if (format === 'xml') return { format, mappings: parseXml(input) };
  throw new Error('Could not detect input format. Please provide valid JSON or XML.');
}
