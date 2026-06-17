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
    { name: 'parse_status', dataType: 'string', direction: 'output', length: 256 },
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

/** Raw (uncast) JSON access expression for a dotted source path. */
function jsonAccess(sourcePath: string): string {
  return 'data' + sourcePath.split('.').map(p => `['${p}']`).join('');
}

/** Raw (uncast) XML access expression for a scalar mapping. */
function xmlAccess(m: VariableMapping): string {
  const relParts = m.sourcePath.split('/').slice(1); // drop the root tag
  if (relParts.length === 0) return 'root.text';

  const xpath = relParts.slice(0, -1).join('/');
  const lastPart = relParts[relParts.length - 1];

  if (xpath === '') {
    return `(root.attrib.get('${lastPart}') or _txt(root, '${lastPart}'))`;
  }
  return `(_attr(root, '${xpath}', '${lastPart}') or _txt(root, '${xpath}/${lastPart}'))`;
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
    ? `        data = json.loads(${inputVarName})`
    : `        root = ET.fromstring(${inputVarName})`);
  lines.push('    except Exception as _e:');
  lines.push(`        parse_status = '${format === 'json' ? 'JSON' : 'XML'} parse error: ' + str(_e)`);
  lines.push(retEarly);
  lines.push('');

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
  lines.push('    except Exception as _e:');
  lines.push("        parse_status = 'Extraction error: ' + str(_e)");
  lines.push('');
  lines.push(ret);
  lines.push('');

  return lines.join('\n');
}

function jsonDataGrid(m: VariableMapping): string[] {
  const indent = '        ';
  const cols = m.dataGridColumns ?? [];
  const meta = cols.map(c => `{"name": "${c.name}", "type": "${dgTypeStr(c.dataType)}"}`).join(', ');
  const row = cols.map(c => `${helperForColumn(c.dataType)}(_item.get('${c.sourcePath}'))`).join(', ');

  return [
    `${indent}# DataGrid: ${m.variableName}`,
    `${indent}_arr = ${jsonAccess(m.sourcePath)}`,
    `${indent}if isinstance(_arr, list) and len(_arr) > 0:`,
    `${indent}    _rows = [[${row}] for _item in _arr]`,
    `${indent}    ${m.variableName} = json.dumps([{"metadata": [${meta}]}, {"data": _rows}])`,
  ];
}

function xmlDataGrid(m: VariableMapping): string[] {
  const indent = '        ';
  const cols = m.dataGridColumns ?? [];
  const xpath = m.sourcePath.split('/').slice(1).join('/');
  const meta = cols.map(c => `{"name": "${c.name}", "type": "${dgTypeStr(c.dataType)}"}`).join(', ');
  const row = cols
    .map(c => `${helperForColumn(c.dataType)}((_el.attrib.get('${c.sourcePath}') or _txt(_el, '${c.sourcePath}')))`)
    .join(', ');

  return [
    `${indent}# DataGrid: ${m.variableName}`,
    `${indent}_elements = root.findall('${xpath}')`,
    `${indent}if _elements:`,
    `${indent}    _rows = [[${row}] for _el in _elements]`,
    `${indent}    ${m.variableName} = json.dumps([{"metadata": [${meta}]}, {"data": _rows}])`,
  ];
}
