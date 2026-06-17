// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import type { VariableMapping, SasDataType } from '../../types/schemaBuilder';

const SAS_TYPES: SasDataType[] = [
  'Character',
  'Integer',
  'Decimal',
  'Boolean',
  'Date',
  'Datetime',
  'DataGrid',
];

interface Props {
  mappings: VariableMapping[];
  onChange: (index: number, field: 'variableName' | 'dataType' | 'length', value: string) => void;
  onDelete: (index: number) => void;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '...' : s;
}

// Only string-like types carry an editable storage length.
const STRING_LIKE: SasDataType[] = ['Character', 'Date', 'Datetime'];

export const VariableTable: React.FC<Props> = ({ mappings, onChange, onDelete }) => {
  return (
    <div className="schema-builder__table-wrapper">
      <table className="schema-builder__table">
        <thead>
          <tr>
            <th className="sb-col-num">#</th>
            <th className="sb-col-source">Source Path</th>
            <th className="sb-col-varname">Variable Name</th>
            <th className="sb-col-type">SAS ID Type</th>
            <th className="sb-col-length">Length</th>
            <th className="sb-col-sample">Sample Value</th>
            <th className="sb-col-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {mappings.map((m, i) => {
            const nameLen = m.variableName.length;
            const nameTooLong = nameLen > 32;
            const nameInvalid = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.variableName);
            const supportsLength = STRING_LIKE.includes(m.dataType);

            return (
              <tr key={i} className={m.isArray ? 'schema-builder__row--datagrid' : ''}>
                <td className="sb-col-num">{i + 1}</td>
                <td className="sb-col-source" title={m.sourcePath}>
                  <code>{m.sourcePath}</code>
                </td>
                <td className="sb-col-varname">
                  <input
                    type="text"
                    value={m.variableName}
                    onChange={e => onChange(i, 'variableName', e.target.value)}
                    className={`schema-builder__var-input${nameTooLong || nameInvalid ? ' schema-builder__var-input--error' : ''}`}
                    maxLength={32}
                  />
                  {nameTooLong && <span className="schema-builder__field-error">Max 32 chars</span>}
                  {nameInvalid && !nameTooLong && (
                    <span className="schema-builder__field-error">Invalid SAS name</span>
                  )}
                  {!nameTooLong && !nameInvalid && (
                    <span className="schema-builder__field-hint">{nameLen}/32</span>
                  )}
                </td>
                <td className="sb-col-type">
                  <select
                    value={m.dataType}
                    onChange={e => onChange(i, 'dataType', e.target.value)}
                    className={`schema-builder__type-select schema-builder__type--${m.dataType.toLowerCase()}`}
                  >
                    {SAS_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="sb-col-length">
                  {supportsLength ? (
                    <input
                      type="number"
                      min={1}
                      max={32672}
                      value={m.length ?? ''}
                      onChange={e => onChange(i, 'length', e.target.value)}
                      className="schema-builder__length-input"
                      title="SAS character storage length"
                    />
                  ) : (
                    <span className="schema-builder__length-na">—</span>
                  )}
                </td>
                <td className="sb-col-sample" title={m.sampleValue}>
                  <span className="schema-builder__sample-val">{truncate(m.sampleValue ?? '', 40)}</span>
                </td>
                <td className="sb-col-actions">
                  <button
                    className="schema-builder__row-delete"
                    onClick={() => onDelete(i)}
                    title="Remove variable"
                    type="button"
                  >
                    &times;
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {mappings.length === 0 && (
        <div className="schema-builder__empty">No variables detected. Go back and parse a schema.</div>
      )}
    </div>
  );
};

export default VariableTable;
