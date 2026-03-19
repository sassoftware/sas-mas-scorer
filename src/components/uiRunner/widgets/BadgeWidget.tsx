// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';

interface Props {
  field: UIField;
  value: unknown;
}

const colorMap: Record<string, string> = {
  accept: 'var(--sas-green, #388e3c)',
  approve: 'var(--sas-green, #388e3c)',
  approved: 'var(--sas-green, #388e3c)',
  yes: 'var(--sas-green, #388e3c)',
  pass: 'var(--sas-green, #388e3c)',
  reject: 'var(--sas-red, #d32f2f)',
  denied: 'var(--sas-red, #d32f2f)',
  deny: 'var(--sas-red, #d32f2f)',
  no: 'var(--sas-red, #d32f2f)',
  fail: 'var(--sas-red, #d32f2f)',
  review: 'var(--sas-yellow, #f9a825)',
  pending: 'var(--sas-yellow, #f9a825)',
  refer: 'var(--sas-yellow, #f9a825)',
};

function getColor(val: string): string {
  const lower = val.toLowerCase().trim();
  return colorMap[lower] ?? 'var(--sas-blue, #1976d2)';
}

export const BadgeWidget: React.FC<Props> = ({ field, value }) => {
  if (value === null || value === undefined) {
    return <span className="ui-runner__badge ui-runner__badge--null">--</span>;
  }

  const rawStr = String(value);
  const mappings = field.validation?.valueMappings;

  // Apply value mapping if defined
  let displayText = rawStr;
  let wasMapped = false;
  if (mappings?.length) {
    const match = mappings.find(m => m.from === rawStr);
    if (match) {
      displayText = match.to;
      wasMapped = true;
    }
  }

  // Apply decimal formatting for numeric values (only if not already mapped)
  const decimals = field.validation?.decimals;
  if (!wasMapped && decimals !== undefined && typeof value === 'number') {
    displayText = value.toFixed(decimals);
  }

  const bg = getColor(displayText);

  return (
    <span className="ui-runner__badge" style={{ backgroundColor: bg }}>
      {displayText}
    </span>
  );
};
