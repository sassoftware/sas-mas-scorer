// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { StepParameter } from '../../types';
import { Badge, TypeBadge } from '../common/Badge';
import { Button } from '../common/Button';
import { MappingColumnOption } from './ColumnMappingGrid';
import { ExpectedSources } from './inputMapping';
import { ComparisonRule } from './ComparisonRule';

interface ExpectedOutputsMappingProps {
  /** Unique per page, for the element ids */
  idPrefix: string;
  outputs: StepParameter[];
  columns: MappingColumnOption[];
  /** The mapping in use: output → column */
  expected: ExpectedSources;
  /** What was suggested by name when the data was loaded, to label it as such */
  suggested: ExpectedSources;
  onChange: (output: string, column: string | null) => void;
  onClearAll: () => void;
  disabled?: boolean;
}

/**
 * The optional "Expected outputs" part of a batch mapping: per output, the
 * column that holds the value each row should produce. Suggestions by name
 * are shown as such and can be removed one by one; an output without a
 * column is not compared.
 */
export const ExpectedOutputsMapping: React.FC<ExpectedOutputsMappingProps> = ({
  idPrefix,
  outputs,
  columns,
  expected,
  suggested,
  onChange,
  onClearAll,
  disabled = false,
}) => {
  const mappedCount = outputs.filter(o => expected[o.name]).length;
  // Open when there is something to see; the user can always open it
  const [open, setOpen] = useState(mappedCount > 0);
  const bodyId = `${idPrefix}-body`;

  // New data with suggestions (another file or table): show them
  useEffect(() => {
    if (Object.keys(suggested).length > 0) setOpen(true);
  }, [suggested]);

  if (outputs.length === 0) return null;

  return (
    <section className="expected-mapping" aria-labelledby={`${idPrefix}-title`}>
      <div className="expected-mapping__header">
        <h4 className="expected-mapping__title" id={`${idPrefix}-title`}>
          <button
            type="button"
            className="expected-mapping__toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(v => !v)}
          >
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`expected-mapping__chevron${open ? ' expected-mapping__chevron--open' : ''}`}
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            Expected outputs (optional)
          </button>
        </h4>
        <Badge variant={mappedCount > 0 ? 'info' : 'default'} size="small">
          {mappedCount > 0
            ? `${mappedCount} of ${outputs.length} output${outputs.length === 1 ? '' : 's'} compared`
            : 'Nothing compared'}
        </Badge>
        {mappedCount > 0 && (
          <Button variant="tertiary" size="small" onClick={onClearAll} disabled={disabled}>
            Compare nothing
          </Button>
        )}
      </div>

      <div id={bodyId} hidden={!open} className="expected-mapping__body">
        <p className="expected-mapping__intro">
          Choose the column that holds the value each row should produce. Each row is then marked
          &ldquo;Matches&rdquo; or &ldquo;Differs&rdquo;. Outputs left on &ldquo;Not compared&rdquo;
          are not checked, and a blank cell is not checked for that row. Columns named
          like <code>expected_&lt;output&gt;</code>, <code>Output_&lt;output&gt;</code> or the output
          itself are suggested.
        </p>
        <ComparisonRule />
        <div className="column-mapping__grid">
          {outputs.map((output, index) => {
            const selectId = `${idPrefix}-select-${index}`;
            const column = expected[output.name] ?? '';
            const isSuggestion = !!column && suggested[output.name] === column;
            return (
              <div key={output.name} className="column-mapping__item">
                <div className="column-mapping__row">
                  <div className="column-mapping__param-info">
                    <label htmlFor={selectId} className="column-mapping__param-name">{output.name}</label>
                    <TypeBadge type={output.type} />
                  </div>
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className="column-mapping__arrow" aria-hidden="true"
                  >
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  <select
                    id={selectId}
                    value={column}
                    onChange={(e) => onChange(output.name, e.target.value || null)}
                    className={`sas-input column-mapping__select ${column ? 'column-mapping__select--mapped' : ''}`}
                    disabled={disabled}
                    aria-describedby={isSuggestion ? `${selectId}-suggested` : undefined}
                  >
                    <option value="">Not compared</option>
                    {columns.map(col => (
                      <option key={col.name} value={col.name}>{col.label ?? col.name}</option>
                    ))}
                  </select>
                  {isSuggestion && (
                    <span className="expected-mapping__suggested" id={`${selectId}-suggested`}>
                      Suggested by name
                    </span>
                  )}
                  {column && (
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => onChange(output.name, null)}
                      disabled={disabled}
                      aria-label={`Do not compare ${output.name}`}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ExpectedOutputsMapping;
