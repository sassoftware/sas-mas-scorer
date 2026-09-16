// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export interface ProgressBarProps {
  /** Units completed. Omit (or set `indeterminate`) when there is no total. */
  value?: number;
  /** Units in total; defaults to 100 so `value` can be a percentage. */
  max?: number;
  /** Force the sweeping bar even when a value is known. */
  indeterminate?: boolean;
  /** Left side of the header row — the current phase ("Collecting..."). */
  phase?: React.ReactNode;
  /** Right side of the header row — usually "3 of 8". */
  count?: React.ReactNode;
  /** A line of detail under the bar. */
  message?: React.ReactNode;
  /** Step chips under the message; mark finished ones `.sas-progress__step--done`. */
  steps?: React.ReactNode;
  /** Accessible name for the bar; falls back to `phase` when that is a string. */
  label?: string;
  className?: string;
}

/**
 * Determinate or indeterminate progress block: an optional phase/count
 * header, the bar itself, and an optional message and step list. The bar is
 * a `role="progressbar"`; an indeterminate bar reports no value, which is
 * how screen readers announce "busy" rather than a wrong percentage.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  indeterminate = false,
  phase,
  count,
  message,
  steps,
  label,
  className = '',
}) => {
  const isIndeterminate = indeterminate || value === undefined || max <= 0;
  const percent = isIndeterminate
    ? 0
    : Math.max(0, Math.min(100, ((value as number) / max) * 100));

  const classes = ['sas-progress', isIndeterminate ? 'sas-progress--indeterminate' : '', className]
    .filter(Boolean)
    .join(' ');

  const accessibleName = label ?? (typeof phase === 'string' ? phase : 'Progress');

  return (
    <div className={classes}>
      {(phase || count) && (
        <div className="sas-progress__header">
          {phase && <span className="sas-progress__phase">{phase}</span>}
          {count && <span className="sas-progress__count">{count}</span>}
        </div>
      )}
      <div
        className="sas-progress__track"
        role="progressbar"
        aria-label={accessibleName}
        aria-valuemin={isIndeterminate ? undefined : 0}
        aria-valuemax={isIndeterminate ? undefined : max}
        aria-valuenow={isIndeterminate ? undefined : value}
      >
        <div
          className="sas-progress__fill"
          style={isIndeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      {message && <div className="sas-progress__message">{message}</div>}
      {steps && <div className="sas-progress__steps">{steps}</div>}
    </div>
  );
};

export default ProgressBar;
