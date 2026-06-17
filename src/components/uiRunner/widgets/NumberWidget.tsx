// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';
import { DecimalInput } from '../../common/DecimalInput';

interface Props {
  field: UIField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export const NumberWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  return (
    <DecimalInput
      value={value}
      onChange={(num) => onChange(num)}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};
