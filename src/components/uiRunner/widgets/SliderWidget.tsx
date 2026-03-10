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

export const SliderWidget: React.FC<Props> = ({ field, value, onChange, disabled }) => {
  const min = field.validation?.min ?? 0;
  const max = field.validation?.max ?? 100;
  const numValue = typeof value === 'number' ? value : min;

  return (
    <div className="ui-runner__slider">
      <input
        type="range"
        className="ui-runner__slider-input"
        min={min}
        max={max}
        step="any"
        value={numValue}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
      />
      <span className="ui-runner__slider-value">{numValue}</span>
    </div>
  );
};
