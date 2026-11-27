// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useState } from 'react';
import { UIField } from '../../../types/uiBuilder';
import { parseNumberText } from '../../../utils/uiDefaults';
import { currencyOf, currencySymbol, formatPercentOrCurrency, percentAsPoints, tidy } from '../../../utils/numberFormat';
import { InputWidgetProps, controlAria } from './types';

/** What the user sees for a value MAS gets (0.125 -> "12.5" for a fraction percent). */
function shown(field: UIField, value: unknown): string {
  if (typeof value !== 'number') return value === null || value === undefined ? '' : String(value);
  if (field.widget === 'percent' && !percentAsPoints(field)) return String(tidy(value * 100));
  return String(value);
}

/**
 * A number entered as a percentage or an amount of money, with the % sign or
 * the currency symbol beside it. It sends the plain number: for a percentage
 * either the fraction (12.5 % -> 0.125) or the percentage points (12.5), as
 * the author set. The number that will be sent is shown under the field.
 */
export const PercentCurrencyInputWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, id } = props;
  const percent = field.widget === 'percent';
  const [text, setText] = useState(shown(field, value));
  const noteId = useId();

  // Follow outside changes (Clear All, defaults) without overwriting typing that means the same.
  useEffect(() => {
    const next = shown(field, value);
    const typed = parseNumberText(text);
    const fromText = typed === null || Number.isNaN(typed) ? null : percent && !percentAsPoints(field) ? tidy(typed / 100) : typed;
    if (fromText !== value && next !== text) setText(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (raw: string) => {
    setText(raw);
    const n = parseNumberText(raw);
    if (n === null) onChange(null);
    else if (Number.isNaN(n)) onChange(raw); // reported by the pre-run check
    else onChange(percent && !percentAsPoints(field) ? tidy(n / 100) : n);
  };

  const symbol = percent ? '%' : currencySymbol(currencyOf(field));
  const sent = typeof value === 'number' ? String(value) : null;
  return (
    <div className="ui-runner__amount">
      <div className={`ui-runner__amount-box${percent ? ' ui-runner__amount-box--suffix' : ''}`}>
        {!percent && <span className="ui-runner__amount-symbol" aria-hidden="true">{symbol}</span>}
        <input
          type="text"
          inputMode="decimal"
          className="sas-input"
          {...controlAria(props)}
          id={id}
          aria-describedby={[props.describedBy, noteId].filter(Boolean).join(' ') || undefined}
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => emit(e.target.value)}
          disabled={disabled}
        />
        {percent && <span className="ui-runner__amount-symbol" aria-hidden="true">{symbol}</span>}
      </div>
      <span id={noteId} className="ui-runner__field-constraint">
        {percent
          ? `In percent${sent !== null ? `; sent to MAS as ${sent}` : percentAsPoints(field) ? '; 12.5 % is sent as 12.5' : '; 12.5 % is sent as 0.125'}`
          : `In ${currencyOf(field)}${sent !== null ? `; sent to MAS as ${sent}` : ''}`}
      </span>
    </div>
  );
};

/** A returned number shown as a percentage or an amount of money. */
export const PercentCurrencyOutputWidget: React.FC<{ field: UIField; value: unknown }> = ({ field, value }) => {
  if (value === null || value === undefined || value === '') {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }
  const text = formatPercentOrCurrency(field, value);
  return <span className="ui-runner__readonly" title={`Returned ${String(value)}`}>{text ?? String(value)}</span>;
};
