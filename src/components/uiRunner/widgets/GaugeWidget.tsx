// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface Props {
  value: unknown;
  label?: string;
}

export const GaugeWidget: React.FC<Props> = ({ value, label }) => {
  const numValue = typeof value === 'number' ? value : 0;
  // Normalize to 0-100 range; if already 0-1, multiply by 100
  const pct = numValue > 1 ? Math.min(numValue, 100) : numValue * 100;
  const displayValue = typeof value === 'number' ? value : '--';

  const getColor = (p: number) => {
    if (p < 30) return 'var(--sas-red, #d32f2f)';
    if (p < 70) return 'var(--sas-yellow, #f9a825)';
    return 'var(--sas-green, #388e3c)';
  };

  return (
    <div className="ui-runner__gauge">
      <div className="ui-runner__gauge-bar">
        <div
          className="ui-runner__gauge-fill"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: getColor(pct) }}
        />
      </div>
      <div className="ui-runner__gauge-info">
        <span className="ui-runner__gauge-value">{displayValue}</span>
        {label && <span className="ui-runner__gauge-label">{label}</span>}
      </div>
    </div>
  );
};
