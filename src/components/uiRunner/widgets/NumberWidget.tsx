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

export const NumberWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  return (
    <input
      type="number"
      step="any"
      className="sas-input"
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => {
        const val = e.target.value;
        onChange(val === '' ? null : parseFloat(val));
      }}
      min={field.validation?.min}
      max={field.validation?.max}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};
