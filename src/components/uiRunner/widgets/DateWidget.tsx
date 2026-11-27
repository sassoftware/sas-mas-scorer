// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';
import {
  formatSasValue,
  isoFromSasDate,
  isoFromSasDatetime,
  sasDateFromIso,
  sasDatetimeFromIso,
} from '../../../utils/sasDate';
import { InputWidgetProps, controlAria } from './types';

const kindOf = (field: UIField): 'date' | 'datetime' => (field.widget === 'datetime' ? 'datetime' : 'date');

/**
 * A date (or date and time) picker for a numeric input. It sends the SAS
 * value MAS expects: days since 1 January 1960 for a date, seconds since
 * 1 January 1960 00:00:00 for a datetime. The number that will be sent is
 * shown under the control, so nothing is hidden.
 */
export const DateInputWidget: React.FC<InputWidgetProps> = (props) => {
  const { field, value, onChange, disabled, id } = props;
  const kind = kindOf(field);
  const iso = kind === 'date' ? isoFromSasDate(value) : isoFromSasDatetime(value);
  const sentId = id ? `${id}-sas` : undefined;
  const describedBy = [props.describedBy, sentId].filter(Boolean).join(' ') || undefined;
  const hasValue = value !== null && value !== undefined && value !== '';

  return (
    <div className="ui-runner__date">
      <input
        type={kind === 'date' ? 'date' : 'datetime-local'}
        step={kind === 'datetime' ? 1 : undefined}
        min={kind === 'date' ? '1000-01-01' : '1000-01-01T00:00:00'}
        max={kind === 'date' ? '9999-12-31' : '9999-12-31T23:59:59'}
        className="sas-input"
        {...controlAria(props)}
        aria-describedby={describedBy}
        value={iso}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) {
            onChange(null);
            return;
          }
          onChange(kind === 'date' ? sasDateFromIso(raw) : sasDatetimeFromIso(raw));
        }}
        disabled={disabled}
      />
      <span id={sentId} className="ui-runner__field-constraint">
        {hasValue && iso
          ? `Sent to MAS as ${String(value)} (SAS ${kind === 'date' ? 'date' : 'datetime'} value)`
          : `Sent to MAS as a SAS ${kind === 'date' ? 'date' : 'datetime'} value`}
      </span>
    </div>
  );
};

/** A returned SAS date or datetime, shown as a readable date. */
export const DateOutputWidget: React.FC<{ field: UIField; value: unknown }> = ({ field, value }) => {
  if (value === null || value === undefined || value === '') {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }
  const text = formatSasValue(value, kindOf(field));
  if (text === null) {
    // Not a date MAS could mean (text, or a number far outside any calendar): show it as it came.
    return <span className="ui-runner__readonly">{String(value)}</span>;
  }
  return (
    <span className="ui-runner__readonly" title={`SAS ${kindOf(field)} value ${String(value)}`}>
      {text}
    </span>
  );
};
