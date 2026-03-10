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

export const DropdownWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const options = field.validation?.options ?? [];

  return (
    <select
      className="sas-input"
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
