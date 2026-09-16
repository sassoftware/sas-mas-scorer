// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export type IconButtonSize = 'small' | 'medium';
export type IconButtonVariant = 'plain' | 'danger';

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name — required, because the only visible content is an icon. */
  'aria-label': string;
  /** Optional tooltip; defaults to nothing so the aria-label is not read twice. */
  title?: string;
  /** small = 24px target (16px icon), medium = 32px target (20px icon). */
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** The icon: an inline <svg>. It is sized by the button, so omit width/height. */
  children: React.ReactNode;
}

/**
 * Square, icon-only button with a guaranteed 24x24 minimum target and the
 * shared focus ring. Use it for close, clear, remove, expand and similar
 * affordances instead of a bare <button> around an <svg>.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { size = 'medium', variant = 'plain', className = '', type = 'button', children, ...props },
    ref
  ) => {
    const classes = [
      'sas-icon-button',
      `sas-icon-button--${size}`,
      variant !== 'plain' ? `sas-icon-button--${variant}` : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} type={type} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default IconButton;
