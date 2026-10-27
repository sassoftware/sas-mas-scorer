// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { getToggleValues } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

/**
 * On/off switch. It sends the field's On / Off values: 1 / 0 for a numeric
 * parameter and "Y" / "N" for a string parameter unless the author set
 * others. The runner seeds it with Off, so "No" on screen is what is sent.
 */
export const ToggleWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, parameter } = props;
  const { on, off } = getToggleValues(field, parameter?.type);
  const isOn = (value !== null && value !== undefined && String(value) === String(on))
    // Values saved before on/off became configurable.
    || value === true
    || (on === 1 && (value === 'true' || value === 'yes'));

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      className={`ui-runner__toggle ${isOn ? 'ui-runner__toggle--on' : ''}`}
      {...controlAria(props)}
      aria-labelledby={props.labelId}
      onClick={() => onChange(isOn ? off : on)}
      disabled={disabled}
    >
      <span className="ui-runner__toggle-track" aria-hidden="true">
        <span className="ui-runner__toggle-thumb" />
      </span>
      <span className="ui-runner__toggle-label" aria-hidden="true">{isOn ? 'Yes' : 'No'}</span>
    </button>
  );
};
