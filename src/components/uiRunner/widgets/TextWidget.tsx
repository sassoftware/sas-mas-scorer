// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { InputWidgetProps, controlAria } from './types';

/**
 * Free text. It keeps what is typed; the runner converts by the parameter
 * type before sending, and the pre-run check reports text that is too long
 * or not a number for a numeric parameter.
 */
export const TextWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled } = props;
  return (
    <input
      type="text"
      className="sas-input"
      {...controlAria(props)}
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};
