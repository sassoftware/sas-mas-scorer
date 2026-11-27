// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { InputWidgetProps } from './types';

/**
 * A checkbox per option for a list (array) input: the ticked options' values
 * are sent as the list, in the options' order. Nothing ticked sends missing.
 */
export const CheckboxGroupWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, labelId, describedBy, invalid } = props;
  const options = field.validation?.options ?? [];
  const chosen = new Set((Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : String(value).split(','))
    .map(v => String(v).trim()));
  if (options.length === 0) {
    return <p className="ui-runner__readonly">This list has no options yet. The app author adds them in the builder.</p>;
  }
  const toggle = (optValue: string, on: boolean) => {
    const next = options
      .map(o => String(o.value))
      .filter(v => (v === optValue ? on : chosen.has(v)));
    onChange(next.length ? next : null);
  };
  return (
    <div
      className="ui-runner__checkgroup"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy || undefined}
      aria-invalid={invalid || undefined}
    >
      {options.map((o, i) => {
        const v = String(o.value);
        return (
          <label key={`${v}-${i}`} className="ui-runner__checkbox">
            <input type="checkbox" checked={chosen.has(v)} disabled={disabled} onChange={(e) => toggle(v, e.target.checked)} />
            <span>{o.label || v}</span>
          </label>
        );
      })}
    </div>
  );
};
