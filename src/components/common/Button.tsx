// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

/**
 * Which variant to use — the convention every dialog and toolbar follows:
 * - `primary`   the one confirming / main action ("Save", "Score", "Import")
 * - `tertiary`  cancel, close, back — the quiet way out of a dialog
 * - `danger`    a destructive confirmation ("Delete", "Remove") — never the trigger
 *               in a list row, only the confirm step
 * - `secondary` a real alternative action alongside the primary ("Export", "Refresh")
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'medium',
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  className = '',
  ...props
}) => {
  const baseClass = 'sas-button';
  const classes = [
    baseClass,
    `${baseClass}--${variant}`,
    `${baseClass}--${size}`,
    fullWidth ? `${baseClass}--full-width` : '',
    loading ? `${baseClass}--loading` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {loading ? (
        <span className={`${baseClass}__spinner`}>
          <svg viewBox="0 0 24 24" className="spinner-icon">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="31.4"
              strokeDashoffset="10"
            />
          </svg>
        </span>
      ) : icon ? (
        <span className={`${baseClass}__icon`}>{icon}</span>
      ) : null}
      <span className={`${baseClass}__text`}>{children}</span>
    </button>
  );
};

export default Button;
