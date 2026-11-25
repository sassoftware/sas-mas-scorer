// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { KpiBand, UIField } from '../../../types/uiBuilder';

/** Band colours: each pairs a stripe colour with the band's own word, never colour alone. */
export const KPI_TONES: Record<KpiBand['tone'], { name: string; color: string }> = {
  good: { name: 'Green', color: 'var(--sas-success)' },
  warning: { name: 'Amber', color: 'var(--sas-warning)' },
  critical: { name: 'Red', color: 'var(--sas-error)' },
  info: { name: 'Blue', color: 'var(--sas-blue-primary)' },
  neutral: { name: 'Gray', color: 'var(--sas-gray-500)' },
};

/** The band a value falls in: the first whose "below" it is under, else the last one without a limit. */
export function kpiBandFor(bands: KpiBand[] | undefined, value: number): KpiBand | null {
  if (!bands?.length) return null;
  for (const b of bands) {
    if (b.below === undefined || value < b.below) return b;
  }
  return null;
}

/**
 * One result as a large number, with its label, unit and (when the author set
 * bands) a coloured stripe and the band's word, such as "High".
 */
export const KpiWidget: React.FC<{ field: UIField; value: unknown }> = ({ field, value }) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  const unit = field.validation?.unit;
  const decimals = field.validation?.decimals;
  if (value === null || value === undefined || value === '') {
    return (
      <div className="ui-runner__kpi">
        <span className="ui-runner__kpi-value ui-runner__readonly--null">--</span>
      </div>
    );
  }
  if (!Number.isFinite(n)) {
    return <div className="ui-runner__kpi"><span className="ui-runner__kpi-value">{String(value)}</span></div>;
  }
  const text = new Intl.NumberFormat(undefined, decimals !== undefined
    ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
    : { maximumFractionDigits: 4 }).format(n);
  const band = kpiBandFor(field.validation?.kpiBands, n);
  const tone = band ? KPI_TONES[band.tone] ?? KPI_TONES.neutral : null;
  return (
    <div
      className={`ui-runner__kpi${band ? ' ui-runner__kpi--banded' : ''}`}
      style={tone ? ({ '--kpi-color': tone.color } as React.CSSProperties) : undefined}
      title={`Returned ${String(value)}`}
    >
      <span className="ui-runner__kpi-value">
        {text}
        {unit && <span className="ui-runner__kpi-unit">{unit}</span>}
      </span>
      {band && (
        <span className="ui-runner__kpi-band">
          <span className="ui-runner__kpi-dot" aria-hidden="true" />
          {band.label}
        </span>
      )}
    </div>
  );
};
