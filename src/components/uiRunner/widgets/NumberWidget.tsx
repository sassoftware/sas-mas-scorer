// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { isIntegerType, parseNumberText } from '../../../utils/uiDefaults';
import { InputWidgetProps, controlAria } from './types';

const toText = (value: unknown): string =>
  value !== null && value !== undefined ? String(value) : '';

/** Round away float noise from repeated stepping (0.1 + 0.2). */
const roundToStep = (n: number, step: number): number => {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(n.toFixed(Math.min(decimals + 2, 12)));
};

/**
 * Number entry that honours the field's Min, Max and Step. It keeps the text
 * as typed (a trailing "3." or "3,0" is not collapsed) and accepts a comma or
 * dot decimal mark. Arrow Up / Down step by Step within Min and Max. Text
 * that is not a number is passed on as text, so the pre-run check can report
 * it instead of it being sent as missing.
 */
export const NumberWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, parameter } = props;
  const { min, max } = field.validation ?? {};
  const step = field.validation?.step && field.validation.step > 0 ? field.validation.step : 1;
  const integer = isIntegerType(parameter?.type);

  const [text, setText] = useState(toText(value));

  // Follow outside changes (Clear All, defaults) without clobbering an
  // in-progress entry whose number still matches.
  useEffect(() => {
    const current = parseNumberText(text);
    if (typeof value === 'number') {
      if (current !== value) setText(String(value));
    } else if (value === null || value === undefined) {
      if (current !== null) setText('');
    } else if (String(value) !== text) {
      setText(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (raw: string) => {
    setText(raw);
    const num = parseNumberText(raw);
    onChange(num === null ? null : Number.isNaN(num) ? raw : num);
  };

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined && out < min) out = min;
    if (max !== undefined && out > max) out = max;
    return out;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const current = parseNumberText(text);
    const base = current === null || Number.isNaN(current) ? (min ?? 0) : current;
    const next = clamp(roundToStep(base + (e.key === 'ArrowUp' ? step : -step), step));
    emit(String(next));
  };

  const parsed = parseNumberText(text);
  const hasNumber = parsed !== null && !Number.isNaN(parsed);

  return (
    <input
      type="text"
      role="spinbutton"
      inputMode={integer && (min === undefined || min >= 0) ? 'numeric' : 'decimal'}
      className="sas-input"
      {...controlAria(props)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={hasNumber ? parsed : undefined}
      value={text}
      onChange={(e) => emit(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={field.placeholder}
      disabled={disabled}
    />
  );
};
