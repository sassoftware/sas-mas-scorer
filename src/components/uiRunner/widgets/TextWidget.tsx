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

export const TextWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  return (
    <input
      type="text"
      className="sas-input"
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};
