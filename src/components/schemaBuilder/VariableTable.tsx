// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { IconButton } from '../common/IconButton';
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
      <table className="sas-table sas-table--compact schema-builder__table">
        <thead className="sas-table__head">
          <tr>
            <th scope="col" className="sas-table__th schema-builder__col-num">#</th>
            <th scope="col" className="sas-table__th schema-builder__col-source">Source Path</th>
            <th scope="col" className="sas-table__th">Variable Name</th>
            <th scope="col" className="sas-table__th">SAS ID Type</th>
            <th scope="col" className="sas-table__th schema-builder__col-length">Length</th>
            <th scope="col" className="sas-table__th">Sample Value</th>
            <th scope="col" className="sas-table__th schema-builder__col-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {mappings.map((m, i) => {
            const nameLen = m.variableName.length;
            const nameTooLong = nameLen > 32;
            const nameInvalid = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.variableName);
            const supportsLength = STRING_LIKE.includes(m.dataType);
            const rowLabel = `row ${i + 1}`;

            return (
              <tr key={i} className={`sas-table__row${m.isArray ? ' schema-builder__row--datagrid' : ''}`}>
                <td className="sas-table__td schema-builder__col-num">{i + 1}</td>
                <td className="sas-table__td schema-builder__col-source" title={m.sourcePath}>
                  <code>{m.sourcePath}</code>
                </td>
                <td className="sas-table__td">
                  <input
                    type="text"
                    value={m.variableName}
                    onChange={e => onChange(i, 'variableName', e.target.value)}
                    className={`schema-builder__var-input${nameTooLong || nameInvalid ? ' schema-builder__var-input--error' : ''}`}
                    maxLength={32}
                    aria-label={`Variable Name, ${rowLabel}`}
                  />
                  {nameTooLong && <span className="schema-builder__field-error">Max 32 chars</span>}
                  {nameInvalid && !nameTooLong && (
                    <span className="schema-builder__field-error">Invalid SAS name</span>
                  )}
                  {!nameTooLong && !nameInvalid && (
                    <span className="schema-builder__field-hint">{nameLen}/32</span>
                  )}
                </td>
                <td className="sas-table__td">
                  <select
                    value={m.dataType}
                    onChange={e => onChange(i, 'dataType', e.target.value)}
                    className={`schema-builder__type-select schema-builder__type--${m.dataType.toLowerCase()}`}
                    aria-label={`SAS ID Type, ${rowLabel}`}
                  >
                    {SAS_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="sas-table__td schema-builder__col-length">
                  {supportsLength ? (
                    <input
                      type="number"
                      min={1}
                      max={32672}
                      value={m.length ?? ''}
                      onChange={e => onChange(i, 'length', e.target.value)}
                      className="schema-builder__length-input"
                      title="SAS character storage length"
                      aria-label={`Length, ${rowLabel}`}
                    />
                  ) : (
                    <span className="schema-builder__length-na">—</span>
                  )}
                </td>
                <td className="sas-table__td" title={m.sampleValue}>
                  <span className="schema-builder__sample-val">{truncate(m.sampleValue ?? '', 40)}</span>
                </td>
                <td className="sas-table__td schema-builder__col-actions">
                  <IconButton
                    size="small"
                    variant="danger"
                    onClick={() => onDelete(i)}
                    aria-label={`Remove ${m.variableName || `variable ${i + 1}`}`}
                    title="Remove variable"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </IconButton>
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
