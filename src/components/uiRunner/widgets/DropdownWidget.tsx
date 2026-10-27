// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { InputWidgetProps, controlAria } from './types';

export const DropdownWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled } = props;
  const options = field.validation?.options ?? [];

  return (
    <select
      className="sas-input"
      {...controlAria(props)}
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => {
        const selected = options.find(o => String(o.value) === e.target.value);
        onChange(selected ? selected.value : e.target.value || null);
      }}
      disabled={disabled}
    >
      <option value="">{field.placeholder || 'Select...'}</option>
      {options.map((opt, i) => (
        <option key={i} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};
