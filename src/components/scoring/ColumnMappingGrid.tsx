// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { StepParameter } from '../../types';
import { Badge, TypeBadge } from '../common/Badge';
import { Button } from '../common/Button';
import {
  InputSource,
  InputSources,
  MappingNote,
  MappingSummary,
  checkConstant,
  describeSummary,
  sourceOf,
} from './inputMapping';

export interface MappingColumnOption {
  name: string;
  /** Shown in the dropdown instead of the bare name (e.g. "AGE (double)") */
  label?: string;
}

interface ColumnMappingGridProps {
  /** Unique per page, for the element ids */
  idPrefix: string;
  parameters: StepParameter[];
  columns: MappingColumnOption[];
  sources: InputSources;
  summary: MappingSummary;
  onChange: (paramName: string, source: InputSource) => void;
  onSetUnsetToMissing: () => void;
  /** Per-input notes shown under the row (unreadable values, type conflicts) */
  notes?: Record<string, MappingNote[]>;
  disabled?: boolean;
}

const MISSING_VALUE = 'missing';
const CONSTANT_VALUE = 'constant';
const COLUMN_PREFIX = 'column:';

const selectValueOf = (source: InputSource): string => {
  switch (source.kind) {
    case 'column': return `${COLUMN_PREFIX}${source.column}`;
    case 'missing': return MISSING_VALUE;
    case 'constant': return CONSTANT_VALUE;
    default: return '';
  }
};

/**
 * The input → source grid shared by the file upload and the CAS table
 * browser. Each input takes a column, "Send as missing (null)" or a constant;
 * the run is enabled once every input has one (see summarizeSources).
 */
export const ColumnMappingGrid: React.FC<ColumnMappingGridProps> = ({
  idPrefix,
  parameters,
  columns,
  sources,
  summary,
  onChange,
  onSetUnsetToMissing,
  notes,
  disabled = false,
}) => {
  const handleSelect = (param: StepParameter, value: string, previous: InputSource) => {
    if (value === MISSING_VALUE) onChange(param.name, { kind: 'missing' });
    else if (value === CONSTANT_VALUE) {
      // Keep a constant already typed when the option is re-picked
      onChange(param.name, previous.kind === 'constant' ? previous : { kind: 'constant', text: '' });
    } else if (value.startsWith(COLUMN_PREFIX)) {
      onChange(param.name, { kind: 'column', column: value.slice(COLUMN_PREFIX.length) });
    } else onChange(param.name, { kind: 'unset' });
  };

  return (
    <>
      <div className="column-mapping__header">
        <h4>Column Mapping</h4>
        <div className="column-mapping__summary">
          <Badge variant={summary.ready ? 'success' : 'warning'}>
            {describeSummary(summary)}
          </Badge>
          {summary.unset > 0 && (
            <Button variant="tertiary" size="small" onClick={onSetUnsetToMissing} disabled={disabled}>
              Send {summary.unset} unset input{summary.unset === 1 ? '' : 's'} as missing
            </Button>
          )}
        </div>
      </div>

      <div className="column-mapping__grid">
        {parameters.map((param, index) => {
          const source = sourceOf(sources, param.name);
          const selectId = `${idPrefix}-source-${index}`;
          const constantId = `${idPrefix}-constant-${index}`;
          const constantErrorId = `${idPrefix}-constant-error-${index}`;
          const notesId = `${idPrefix}-notes-${index}`;
          const rowNotes = notes?.[param.name] ?? [];
          const constantError = source.kind === 'constant'
            ? checkConstant(param, source.text).error
            : null;
          const isArray = param.type.endsWith('Array');

          return (
            <div key={param.name} className="column-mapping__item">
              <div className="column-mapping__row">
                <div className="column-mapping__param-info">
                  <label htmlFor={selectId} className="column-mapping__param-name">{param.name}</label>
                  <TypeBadge type={param.type} />
                </div>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="column-mapping__arrow"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                <select
                  id={selectId}
                  value={selectValueOf(source)}
                  onChange={(e) => handleSelect(param, e.target.value, source)}
                  className={`sas-input column-mapping__select ${source.kind === 'unset' ? 'column-mapping__select--unmapped' : 'column-mapping__select--mapped'}`}
                  aria-describedby={rowNotes.length > 0 ? notesId : undefined}
                  disabled={disabled}
                >
                  <option value="">-- Choose a source --</option>
                  <optgroup label="Without a column">
                    <option value={MISSING_VALUE}>Send as missing (null)</option>
                    <option value={CONSTANT_VALUE}>Constant value…</option>
                  </optgroup>
                  <optgroup label="Columns">
                    {columns.map(col => (
                      <option key={col.name} value={`${COLUMN_PREFIX}${col.name}`}>
                        {col.label ?? col.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {source.kind === 'constant' && (
                  <input
                    id={constantId}
                    type="text"
                    className="sas-input column-mapping__constant"
                    value={source.text}
                    onChange={(e) => onChange(param.name, { kind: 'constant', text: e.target.value })}
                    placeholder={isArray ? 'Values, separated by ;' : 'Value for every row'}
                    aria-label={`Constant value for ${param.name}`}
                    aria-invalid={constantError ? true : undefined}
                    aria-describedby={constantError ? constantErrorId : undefined}
                    disabled={disabled}
                  />
                )}
              </div>
              {constantError && (
                <p id={constantErrorId} className="column-mapping__note column-mapping__note--warning">
                  {param.name}: {constantError}
                </p>
              )}
              {rowNotes.length > 0 && (
                <ul id={notesId} className="column-mapping__notes">
                  {rowNotes.map((note, i) => (
                    <li
                      key={i}
                      className={`column-mapping__note column-mapping__note--${note.tone}`}
                    >
                      <span className="column-mapping__note-tag">
                        {note.tone === 'warning' ? 'Check:' : 'Note:'}
                      </span>{' '}
                      {note.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default ColumnMappingGrid;
