// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface EmptyStateProps {
  /** Decorative icon (an inline <svg>); hidden from assistive technology. */
  icon?: React.ReactNode;
  /** What is empty, e.g. "No modules found". */
  title: React.ReactNode;
  /** Why it is empty or what to do about it. */
  hint?: React.ReactNode;
  /** A call to action, typically a <Button>. */
  action?: React.ReactNode;
  className?: string;
}

/** Default icon: an empty clipboard, matching the original DataTable empty state. */
export const EmptyStateIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);

/**
 * Centred "nothing here" panel for lists, tables and panels with no data.
 * Keeps the icon, title, hint and action on one consistent layout so every
 * feature's empty state reads the same.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = <EmptyStateIcon />,
  title,
  hint,
  action,
  className = '',
}) => {
  const classes = ['sas-empty-state', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {icon && (
        <div className="sas-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="sas-empty-state__title">{title}</p>
      {hint && <p className="sas-empty-state__hint">{hint}</p>}
      {action && <div className="sas-empty-state__action">{action}</div>}
    </div>
  );
};

export default EmptyState;
