// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { isArrayType } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

/**
 * Multi-line text, and the default editor for array parameters. It keeps the
 * text as typed ("1, 2," survives mid-entry); the runner turns it into an
 * array for an array parameter before sending.
 */
export const TextareaWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, parameter } = props;
  const displayValue = Array.isArray(value)
    ? value.map(v => (v === null ? '' : String(v))).join(', ')
    : (value !== null && value !== undefined ? String(value) : '');

  const placeholder = field.placeholder
    ?? (isArrayType(parameter?.type) ? 'Comma-separated values' : undefined);

  return (
    <textarea
      className="sas-textarea"
      {...controlAria(props)}
      value={displayValue}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={placeholder}
      disabled={disabled}
      rows={3}
    />
  );
};
