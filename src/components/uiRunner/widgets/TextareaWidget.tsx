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

export const TextareaWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const displayValue = Array.isArray(value)
    ? value.map(v => (v === null ? '' : String(v))).join(', ')
    : (value !== null && value !== undefined ? String(value) : '');

  return (
    <textarea
      className="sas-textarea"
      value={displayValue}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={field.placeholder}
      disabled={disabled}
      rows={3}
    />
  );
};
