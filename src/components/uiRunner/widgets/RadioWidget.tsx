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

export const RadioWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const options = field.validation?.options ?? [];

  return (
    <div className="ui-runner__radio-group">
      {options.map((opt, i) => (
        <label key={i} className="ui-runner__radio-label">
          <input
            type="radio"
            name={`radio-${field.parameterId}`}
            checked={String(value) === String(opt.value)}
            onChange={() => onChange(opt.value)}
            disabled={disabled}
          />
          <span>{opt.label}</span>
        </label>
      ))}
      {options.length === 0 && (
        <span className="ui-runner__radio-empty">No options configured</span>
      )}
    </div>
  );
};
