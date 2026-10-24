// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Generates a Python execute() function for SAS Intelligent Decisioning from a
// set of variable mappings produced by schemaParser.

import type { VariableMapping, InputFormat, DataGridColumn, SasDataType } from '../types/schemaBuilder';
import type { CodeFileSignatureTerm } from '../api/codeFiles';

// Maximum SAS character storage length. A DataGrid is returned from Python as a
// serialized JSON string, so its output term must be long enough to hold the
// full JSON — an undersized length silently truncates it (see the SAS
// Communities blog comment on DataGrids in Python code nodes).
const MAX_CHAR_LENGTH = 32672;

/** Declared length of the parse_status output (the generated code clips to it). */
const PARSE_STATUS_LENGTH = 256;

/**
 * Names the generated Python relies on inside execute(): the module imports and
 * helpers it calls, the builtins it calls, and the fixed outputs. A user
 * variable with one of these names would shadow it (Python then treats the name
 * as a local, so a variable `json` turns `json.loads` into an
 * UnboundLocalError) or clash with an output. Every other generated local
 * carries the `_sb_` prefix, which is reserved as a whole
 * (GENERATED_PY_PREFIX).
 */
export const GENERATED_PY_NAMES: ReadonlySet<string> = new Set([
  'json', 'ET', 'Optional', 'execute',
  '_to_str', '_to_int', '_to_float', '_to_bool', '_txt', '_attr',
  'str', 'int', 'float', 'isinstance', 'len', 'list', 'dict', 'Exception',
  'parse_success', 'parse_status',
]);

/** Prefix reserved for the generated code's own locals and helpers. */
export const GENERATED_PY_PREFIX = '_sb_';

/**
 * Map a SAS ID data type to a SID code file signature dataType. The allowed
 * values are string | decimal | integer | dataGrid | date | datetime | unknown.
 *
 * Notes on the mappings that aren't 1:1:
 * - There is no `boolean`; the generated Python emits 1/0, so Boolean → `integer`.
 * - Date/Datetime → `string`, NOT `date`/`datetime`: the generated code returns
 *   ISO strings via str(), and SID's DS2 wrapper would otherwise call
 *   py.getDate()/getDatetime() on a string value and fail ("found string
 *   parameter"). Declaring them as strings keeps the wrapper on getString().
 * - DataGrid → `string`: a Python code node cannot output a DataGrid; it returns
 *   the grid as a serialized JSON string in a Character variable. The real
 *   DataGrid is rebuilt downstream (Rule Set / Variable Assignment node calling
 *   dataGrid_create()), so the code file's own output term is a string.
 */
function signatureDataType(dt: SasDataType): string {
  switch (dt) {
    case 'Integer': return 'integer';
    case 'Decimal': return 'decimal';
    case 'Boolean': return 'integer';
    case 'Character':
    case 'Date':
    case 'Datetime':
    case 'DataGrid':
    default:
      return 'string';
  }
}

/**
 * Build the code file signature (input + output terms) for the generated
 * execute() function. String terms carry the user-editable length; DataGrid
 * terms are Character strings sized to the maximum so the serialized JSON the
 * Python node returns isn't truncated.
 */
export function buildCodeFileSignature(
  mappings: VariableMapping[],
  inputVarName: string = 'input_string',
): CodeFileSignatureTerm[] {
  const terms: CodeFileSignatureTerm[] = [
    { name: inputVarName, dataType: 'string', direction: 'input', length: MAX_CHAR_LENGTH },
    { name: 'parse_success', dataType: 'integer', direction: 'output' },
    { name: 'parse_status', dataType: 'string', direction: 'output', length: PARSE_STATUS_LENGTH },
  ];

  for (const m of mappings) {
    const dataType = signatureDataType(m.dataType);
    const term: CodeFileSignatureTerm = { name: m.variableName, dataType, direction: 'output' };

    if (m.dataType === 'DataGrid') {
      // Serialized DataGrid JSON — give it the maximum length so it isn't cut off.
      term.length = MAX_CHAR_LENGTH;
    } else if (dataType === 'string' && m.length) {
      term.length = m.length;
    }

    terms.push(term);
  }

  return terms;
}

/**
 * Build the SAS Intelligent Decisioning signature header that must sit on the
 * very first line of a code file's content (above the imports). It is a leading
 * Python comment wrapping a JSON "signatureExtension" object; SID reads it to
 * populate the variable signature with types/lengths — without it, every type
 * defaults to "unknown".
 */
export function buildSignatureHeader(
  mappings: VariableMapping[],
  inputVarName: string = 'input_string',
): string {
  const terms = buildCodeFileSignature(mappings, inputVarName).map((t) => {
    const term: Record<string, unknown> = {
      name: t.name,
      description: '',
      defaultValue: null,
      dataType: t.dataType,
    };
    if (t.length != null) term.length = t.length;
    term.dataGridExtension = t.dataGridExtension ?? null;
    term.direction = t.direction;
    term.generateDataGridColumns = false;
    return term;
  });
  return '#/*' + JSON.stringify({ signatureExtension: terms }) + '*/';
}

// ─── Python code generation ─────────────────────────────────────
//
// The generated execute() is kept deliberately SIMPLE so SID's static analyzer
// (Pyright) can infer each output variable's type. A function full of inline
// conditional expressions (`x = f(a) if a is not None else default`) for dozens
// of variables trips Pyright's "code is too complex to analyze" limit, after
// which every derived signature type becomes "unknown". So all the None/empty
// guarding lives in tiny typed helper functions and the body is just linear
// assignments and helper calls — exactly the "refactor into subroutines / reduce
// conditional code paths" remedy SID recommends.

/** Default initial value (and therefore inferred type) for a scalar variable. */
function defaultValueForType(dt: SasDataType): string {
  switch (dt) {
    case 'Integer': return '0';
    case 'Decimal': return '0.0';
    case 'Boolean': return '0';
    case 'Character':
    case 'Date':
    case 'Datetime':
    default:
      return "''";
  }
}

/**
 * Python type hint for a scalar variable, used when the user opts to default
 * unset variables to missing (None) instead of 0/''. The init line then reads
 * `name: Optional[int] = None` — the annotation pins the type for SID's analyzer
 * (so the derived signature stays integer/decimal/string, not "unknown") while
 * the runtime value is a true missing value when nothing is extracted.
 */
function pyTypeForType(dt: SasDataType): string {
  switch (dt) {
    case 'Integer': return 'int';
    case 'Boolean': return 'int';
    case 'Decimal': return 'float';
    case 'Character':
    case 'Date':
    case 'Datetime':
    default:
      return 'str';
  }
}

/** The conversion helper used for a scalar/column type. */
function helperForType(dt: SasDataType): string {
  switch (dt) {
    case 'Integer': return '_to_int';
    case 'Decimal': return '_to_float';
    case 'Boolean': return '_to_bool';
    case 'Character':
    case 'Date':
    case 'Datetime':
    default:
      return '_to_str';
  }
}

function helperForColumn(dt: DataGridColumn['dataType']): string {
  switch (dt) {
    case 'Integer': return '_to_int';
    case 'Decimal': return '_to_float';
    case 'Character':
    default:
      return '_to_str';
  }
}

function dgTypeStr(dt: DataGridColumn['dataType']): string {
  switch (dt) {
    case 'Integer': return 'integer';
    case 'Decimal': return 'decimal';
    default: return 'character';
  }
}

/** A Python string literal for a JSON key / XML path (JSON string escaping is valid Python). */
function pyStr(s: string): string {
  return JSON.stringify(s);
}

/**
 * None-safe JSON access expression for a dotted source path. `_sb_get` walks
 * the keys and returns None (recording the path in `_sb_absent`) as soon as a
 * key is missing or a parent is not an object, so one absent optional field
 * defaults on its own instead of aborting every later extraction: the same
 * per-field behaviour the XML path gets from `_txt` / `_attr`.
 */
function jsonAccess(sourcePath: string): string {
  const keys = sourcePath.split('.').map(pyStr);
  // A one-element tuple needs its trailing comma.
  return `_sb_get(_sb_data, (${keys.join(', ')}${keys.length === 1 ? ',' : ''}), _sb_absent)`;
}

/** Raw (uncast) XML access expression for a scalar mapping. */
function xmlAccess(m: VariableMapping): string {
  const relParts = m.sourcePath.split('/').slice(1); // drop the root tag
  if (relParts.length === 0) return '_sb_root.text';

  const xpath = relParts.slice(0, -1).join('/');
  const lastPart = relParts[relParts.length - 1];

  if (xpath === '') {
    return `(_sb_root.attrib.get(${pyStr(lastPart)}) or _txt(_sb_root, ${pyStr(lastPart)}))`;
  }
  return `(_attr(_sb_root, ${pyStr(xpath)}, ${pyStr(lastPart)}) or _txt(_sb_root, ${pyStr(`${xpath}/${lastPart}`)}))`;
}

/** Generate the Python execute() function for SAS Intelligent Decisioning */
export function generatePythonCode(
  mappings: VariableMapping[],
  format: InputFormat,
  inputVarName: string = 'input_string',
  missingDefaults: boolean = false,
): string {
  const scalarVars = mappings.filter(m => !m.isArray);
  const gridVars = mappings.filter(m => m.isArray);
  const allOutputNames = ['parse_success', 'parse_status', ...mappings.map(m => m.variableName)];
  const ret = `    return ${allOutputNames.join(', ')}`;       // final return (function body)
  const retEarly = `        return ${allOutputNames.join(', ')}`; // early return inside an if/except block

  const lines: string[] = [];

  // ── SID signature header (must be the first line, above the imports) ──
  lines.push(buildSignatureHeader(mappings, inputVarName));

  // ── Module-level imports (run once at load) ──
  lines.push('import json');
  if (format === 'xml') lines.push('import xml.etree.ElementTree as ET');
  if (missingDefaults) lines.push('from typing import Optional');
  lines.push('');

  // ── Module-level conversion helpers (defined once; small scopes the analyzer
  //    can infer, which keeps execute() simple enough for SID's type analysis).
  //    When missingDefaults is set, an unconvertible/absent value yields None (a
  //    SAS missing value) instead of 0/''; the return annotations keep the type
  //    unambiguous for SID despite the Optional. ──
  if (missingDefaults) {
    lines.push('def _to_str(v) -> Optional[str]:');
    lines.push('    return str(v) if v is not None else None');
    lines.push('def _to_int(v) -> Optional[int]:');
    lines.push("    return int(v) if v not in (None, '') else None");
    lines.push('def _to_float(v) -> Optional[float]:');
    lines.push("    return float(v) if v not in (None, '') else None");
    lines.push('def _to_bool(v) -> Optional[int]:');
    lines.push("    return (1 if str(v).lower() in ('true', '1', 'yes') else 0) if v is not None else None");
  } else {
    lines.push('def _to_str(v):');
    lines.push("    return str(v) if v is not None else ''");
    lines.push('def _to_int(v):');
    lines.push("    return int(v) if v not in (None, '') else 0");
    lines.push('def _to_float(v):');
    lines.push("    return float(v) if v not in (None, '') else 0.0");
    lines.push('def _to_bool(v):');
    lines.push("    return 1 if str(v).lower() in ('true', '1', 'yes') else 0");
  }
  if (format === 'json') {
    lines.push('def _sb_get(obj, keys, absent):');
    lines.push('    for k in keys:');
    lines.push('        if not isinstance(obj, dict) or k not in obj:');
    lines.push("            absent.append('.'.join(keys))");
    lines.push('            return None');
    lines.push('        obj = obj[k]');
    lines.push('    return obj');
  }
  if (format === 'xml') {
    lines.push('def _txt(el, path):');
    lines.push('    node = el.find(path)');
    lines.push('    return node.text.strip() if node is not None and node.text else None');
    lines.push('def _attr(el, path, attr):');
    lines.push('    node = el.find(path) if path else el');
    lines.push('    return node.attrib[attr] if node is not None and attr in node.attrib else None');
  }
  lines.push('');

  lines.push(`def execute(${inputVarName}):`);
  lines.push(`    "Output: ${allOutputNames.join(', ')}"`);
  lines.push('');

  // ── Initialize output variables (establishes each variable's type). In
  //    missing-default mode each variable is annotated and seeded with None so
  //    an unset variable returns a SAS missing value; parse_success/parse_status
  //    are control fields and always keep their concrete defaults. ──
  lines.push('    parse_success = 0');
  lines.push("    parse_status = ''");
  for (const m of scalarVars) {
    lines.push(missingDefaults
      ? `    ${m.variableName}: Optional[${pyTypeForType(m.dataType)}] = None`
      : `    ${m.variableName} = ${defaultValueForType(m.dataType)}`);
  }
  for (const m of gridVars) {
    lines.push(missingDefaults
      ? `    ${m.variableName}: Optional[str] = None`
      : `    ${m.variableName} = ''`);
  }
  lines.push('');

  // ── Null guard ──
  lines.push(`    if ${inputVarName} is None or str(${inputVarName}).strip() == '':`);
  lines.push("        parse_status = 'Input is empty or None'");
  lines.push(retEarly);
  lines.push('');

  // ── Parse ──
  lines.push('    try:');
  lines.push(format === 'json'
    ? `        _sb_data = json.loads(${inputVarName})`
    : `        _sb_root = ET.fromstring(${inputVarName})`);
  lines.push('    except Exception as _sb_e:');
  lines.push(`        parse_status = '${format === 'json' ? 'JSON' : 'XML'} parse error: ' + str(_sb_e)`);
  lines.push(retEarly);
  lines.push('');
  if (format === 'json') {
    // Paths absent from this payload: they keep their defaults and are listed
    // in parse_status, while parse_success still reports a usable parse.
    lines.push('    _sb_absent = []');
  }

  // ── Extract (linear assignments via helpers — no inline conditionals) ──
  lines.push('    try:');
  for (const m of scalarVars) {
    const access = format === 'json' ? jsonAccess(m.sourcePath) : xmlAccess(m);
    lines.push(`        ${m.variableName} = ${helperForType(m.dataType)}(${access})`);
  }
  for (const m of gridVars) {
    lines.push(...(format === 'json' ? jsonDataGrid(m) : xmlDataGrid(m)));
  }
  lines.push('        parse_success = 1');
  lines.push("        parse_status = 'OK'");
  if (format === 'json') {
    lines.push('        if _sb_absent:');
    lines.push(`            parse_status = ('OK; absent: ' + ', '.join(_sb_absent))[:${PARSE_STATUS_LENGTH}]`);
  }
  lines.push('    except Exception as _sb_e:');
  lines.push("        parse_status = 'Extraction error: ' + str(_sb_e)");
  lines.push('');
  lines.push(ret);
  lines.push('');

  return lines.join('\n');
}

function jsonDataGrid(m: VariableMapping): string[] {
  const indent = '        ';
  const cols = m.dataGridColumns ?? [];
  const meta = cols.map(c => `{"name": "${c.name}", "type": "${dgTypeStr(c.dataType)}"}`).join(', ');
  const row = cols.map(c => `${helperForColumn(c.dataType)}(_sb_item.get(${pyStr(c.sourcePath)}))`).join(', ');

  return [
    `${indent}# DataGrid: ${m.variableName}`,
    `${indent}_sb_arr = ${jsonAccess(m.sourcePath)}`,
    `${indent}if isinstance(_sb_arr, list) and len(_sb_arr) > 0:`,
    `${indent}    _sb_rows = [[${row}] for _sb_item in _sb_arr if isinstance(_sb_item, dict)]`,
    `${indent}    ${m.variableName} = json.dumps([{"metadata": [${meta}]}, {"data": _sb_rows}])`,
  ];
}

function xmlDataGrid(m: VariableMapping): string[] {
  const indent = '        ';
  const cols = m.dataGridColumns ?? [];
  const xpath = m.sourcePath.split('/').slice(1).join('/');
  const meta = cols.map(c => `{"name": "${c.name}", "type": "${dgTypeStr(c.dataType)}"}`).join(', ');
  const row = cols
    .map(c => `${helperForColumn(c.dataType)}((_sb_el.attrib.get(${pyStr(c.sourcePath)}) or _txt(_sb_el, ${pyStr(c.sourcePath)})))`)
    .join(', ');

  return [
    `${indent}# DataGrid: ${m.variableName}`,
    `${indent}_sb_elements = _sb_root.findall(${pyStr(xpath)})`,
    `${indent}if _sb_elements:`,
    `${indent}    _sb_rows = [[${row}] for _sb_el in _sb_elements]`,
    `${indent}    ${m.variableName} = json.dumps([{"metadata": [${meta}]}, {"data": _sb_rows}])`,
  ];
}
