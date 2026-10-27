// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { InputWidgetProps } from './types';

export const RadioWidget: React.FC<InputWidgetProps> = ({
  field, value, onChange, disabled, id, labelId, describedBy, invalid,
}) => {
  const options = field.validation?.options ?? [];
  const groupName = `radio-${id ?? field.parameterId}`;

  return (
    <div
      className="ui-runner__radio-group"
      role="radiogroup"
      id={id}
      aria-labelledby={labelId}
      aria-describedby={describedBy || undefined}
      aria-invalid={invalid ? true : undefined}
      aria-required={field.validation?.required ? true : undefined}
    >
      {options.map((opt, i) => (
        <label key={i} className="ui-runner__radio-label">
          <input
            type="radio"
            name={groupName}
            checked={value !== null && value !== undefined && String(value) === String(opt.value)}
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
