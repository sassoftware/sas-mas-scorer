// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { parseNumberText } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

/**
 * Range slider. The runner seeds its value with Min (or the default), so the
 * number shown next to it is the one sent even when it is never dragged.
 */
export const SliderWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled } = props;
  const min = field.validation?.min ?? 0;
  const max = field.validation?.max ?? 100;
  const step = field.validation?.step ?? 1;
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' ? parseNumberText(value)
      : null;
  const numValue = parsed !== null && !Number.isNaN(parsed) ? parsed : min;

  return (
    <div className="ui-runner__slider">
      <input
        type="range"
        className="ui-runner__slider-input"
        {...controlAria(props)}
        min={min}
        max={max}
        step={step}
        value={numValue}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
      />
      <span className="ui-runner__slider-value" aria-hidden="true">{numValue}</span>
    </div>
  );
};
