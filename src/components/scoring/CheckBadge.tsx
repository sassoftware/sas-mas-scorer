// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export type CheckBadgeStatus = 'pass' | 'fail' | 'none' | 'error';

const DEFAULT_LABEL: Record<CheckBadgeStatus, string> = {
  pass: 'Matches',
  fail: 'Differs',
  none: 'Not checked',
  error: 'Error',
};

const VARIANT: Record<CheckBadgeStatus, string> = {
  pass: 'success',
  fail: 'error',
  none: 'default',
  error: 'warning',
};

// A shape per state, so the state reads without the colour: a tick, a cross,
// a dash and an exclamation mark.
const ICON: Record<CheckBadgeStatus, React.ReactNode> = {
  pass: <polyline points="5 12.5 10 17 19 7" />,
  fail: <path d="M6 6l12 12M18 6L6 18" />,
  none: <path d="M6 12h12" />,
  error: <path d="M12 5v9M12 18.5v.5" />,
};

interface CheckBadgeProps {
  status: CheckBadgeStatus;
  /** Visible text; defaults to Matches / Differs / Not checked / Error */
  label?: string;
  size?: 'small' | 'medium';
  title?: string;
}

/** A pass/fail badge that carries its state in text and an icon, never colour alone. */
export const CheckBadge: React.FC<CheckBadgeProps> = ({ status, label, size = 'small', title }) => (
  <span
    className={`sas-badge sas-badge--${VARIANT[status]} sas-badge--${size} check-badge check-badge--${status}`}
    title={title}
  >
    <svg
      className="check-badge__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON[status]}
    </svg>
    {label ?? DEFAULT_LABEL[status]}
  </span>
);

export default CheckBadge;
