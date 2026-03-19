// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField } from '../../../types/uiBuilder';

interface Props {
  field: UIField;
  value: unknown;
}

const defaultColorStops = [
  { upTo: 30, color: 'var(--sas-red, #d32f2f)' },
  { upTo: 70, color: 'var(--sas-yellow, #f9a825)' },
  { upTo: 100, color: 'var(--sas-green, #388e3c)' },
];

export const GaugeWidget: React.FC<Props> = ({ field, value }) => {
  const config = field.validation?.gaugeConfig;
  const gaugeMin = config?.min ?? 0;
  const gaugeMax = config?.max ?? 100;
  const colorStops = config?.colorStops?.length ? config.colorStops : defaultColorStops;
  const decimals = field.validation?.decimals;

  const numValue = typeof value === 'number' ? value : null;
  // Calculate percentage within the defined range
  const range = gaugeMax - gaugeMin;
  const pct = numValue !== null && range > 0
    ? Math.max(0, Math.min(100, ((numValue - gaugeMin) / range) * 100))
    : 0;

  // Format display value
  let displayValue: string;
  if (numValue === null) {
    displayValue = '--';
  } else if (decimals !== undefined) {
    displayValue = numValue.toFixed(decimals);
  } else {
    displayValue = String(numValue);
  }

  const getColor = (percentage: number) => {
    for (const stop of colorStops) {
      if (percentage <= stop.upTo) return stop.color;
    }
    return colorStops[colorStops.length - 1]?.color ?? 'var(--sas-blue, #1976d2)';
  };

  return (
    <div className="ui-runner__gauge">
      <div className="ui-runner__gauge-bar">
        <div
          className="ui-runner__gauge-fill"
          style={{ width: `${pct}%`, backgroundColor: getColor(pct) }}
        />
      </div>
      <div className="ui-runner__gauge-info">
        <span className="ui-runner__gauge-value">{displayValue}</span>
        {field.label && <span className="ui-runner__gauge-label">{field.label}</span>}
      </div>
    </div>
  );
};
