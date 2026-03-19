// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';

interface Props {
  field: UIField;
  value: unknown;
}

export const ReadonlyWidget: React.FC<Props> = ({ field, value }) => {
  if (value === null || value === undefined) {
    return <span className="ui-runner__readonly ui-runner__readonly--null">--</span>;
  }

  if (Array.isArray(value)) {
    return <span className="ui-runner__readonly">[{value.join(', ')}]</span>;
  }

  if (typeof value === 'object') {
    return <pre className="ui-runner__readonly ui-runner__readonly--json">{JSON.stringify(value, null, 2)}</pre>;
  }

  const rawStr = String(value);
  const mappings = field.validation?.valueMappings;
  const decimals = field.validation?.decimals;

  // Apply value mapping if defined (takes priority over decimal formatting)
  if (mappings?.length) {
    const match = mappings.find(m => m.from === rawStr);
    if (match) return <span className="ui-runner__readonly">{match.to}</span>;
  }

  // Apply decimal formatting for numeric values (only if no mapping matched)
  if (decimals !== undefined && typeof value === 'number') {
    return <span className="ui-runner__readonly">{value.toFixed(decimals)}</span>;
  }

  return <span className="ui-runner__readonly">{rawStr}</span>;
};
