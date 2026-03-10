// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';

interface Props {
  field: UIField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export const ToggleWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const isOn = value === true || value === 1 || value === '1' || value === 'true' || value === 'yes';

  return (
    <button
      type="button"
      className={`ui-runner__toggle ${isOn ? 'ui-runner__toggle--on' : ''}`}
      onClick={() => onChange(isOn ? 0 : 1)}
      disabled={disabled}
      aria-label={`${field.label}: ${isOn ? 'On' : 'Off'}`}
    >
      <span className="ui-runner__toggle-track">
        <span className="ui-runner__toggle-thumb" />
      </span>
      <span className="ui-runner__toggle-label">{isOn ? 'Yes' : 'No'}</span>
    </button>
  );
};
