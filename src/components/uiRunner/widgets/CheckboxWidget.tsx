// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';
import { getToggleValues } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

/**
 * A checkbox for an on/off input. Like the Toggle it sends the field's On /
 * Off values: 1 / 0 for a numeric parameter (what MAS takes for a decision
 * boolean; it rejects true and "Y" there) and "Y" / "N" for a string
 * parameter, unless the author set others. Unticked sends Off, not missing.
 */
export const CheckboxInputWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, parameter } = props;
  const { on, off } = getToggleValues(field, parameter?.type);
  const checked = value !== null && value !== undefined && String(value) === String(on);
  return (
    <span className="ui-runner__checkbox">
      <input
        type="checkbox"
        {...controlAria(props)}
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? on : off)}
        disabled={disabled}
      />
      <span className="ui-runner__checkbox-text" aria-hidden="true">{checked ? 'Yes' : 'No'}</span>
    </span>
  );
};

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M7.5 12.5l3 3L16.5 9" />
  </svg>
);

const BOX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
  </svg>
);

/**
 * A returned on/off value: a ticked or empty box with "Yes" or "No", so it
 * never depends on the box alone. A numeric result counts as Yes when it is
 * the On value or, failing that, any number other than 0 (how SAS treats a
 * boolean); text must equal the On or Off value.
 */
export const CheckboxOutputWidget: React.FC<{ field: UIField; value: unknown; type?: string }> = ({ field, value, type }) => {
  if (value === null || value === undefined || value === '') {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }
  const { on, off } = getToggleValues(field, type ?? (typeof value === 'string' ? 'string' : 'decimal'));
  let yes: boolean | null;
  if (String(value) === String(on)) yes = true;
  else if (String(value) === String(off)) yes = false;
  else if (typeof value === 'number') yes = value !== 0;
  else yes = null;
  if (yes === null) return <span className="ui-runner__readonly">{String(value)}</span>;
  return (
    <span className={`ui-runner__checkbox-result${yes ? ' ui-runner__checkbox-result--yes' : ''}`} title={`Returned ${String(value)}`}>
      <span className="ui-runner__checkbox-icon">{yes ? CHECK : BOX}</span>
      {yes ? 'Yes' : 'No'}
    </span>
  );
};
