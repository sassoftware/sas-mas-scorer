// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';
import { BadgeVariant } from '../../common/Badge';

interface Props {
  field: UIField;
  value: unknown;
}

// Decision-style values map onto the shared .sas-badge variants, whose
// light-ground / dark-text pairs are tuned to pass 4.5:1; anything else
// renders as "info".
const variantMap: Record<string, BadgeVariant> = {
  accept: 'success',
  approve: 'success',
  approved: 'success',
  yes: 'success',
  pass: 'success',
  reject: 'error',
  denied: 'error',
  deny: 'error',
  no: 'error',
  fail: 'error',
  review: 'warning',
  pending: 'warning',
  refer: 'warning',
};

function getVariant(val: string): BadgeVariant {
  const lower = val.toLowerCase().trim();
  return variantMap[lower] ?? 'info';
}

const badgeClass = (variant: BadgeVariant) => `sas-badge sas-badge--${variant} ui-runner__badge`;

export const BadgeWidget: React.FC<Props> = ({ field, value }) => {
  if (value === null || value === undefined) {
    return <span className={badgeClass('default')}>--</span>;
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

  return (
    <span className={badgeClass(getVariant(displayText))}>
      {displayText}
    </span>
  );
};
