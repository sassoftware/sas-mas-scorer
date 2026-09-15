// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export interface StepNavItem {
  /** Stable id passed back to onSelect and compared against `active`. */
  id: string;
  label: React.ReactNode;
  /** A step the user cannot reach yet (renders gray and unclickable). */
  disabled?: boolean;
}

export interface StepNavProps {
  steps: StepNavItem[];
  /** id of the step currently shown. */
  active: string;
  onSelect: (id: string) => void;
  /** Accessible name of the <nav>; give each strip its own (default "Steps"). */
  label?: string;
  className?: string;
}

/**
 * Wizard/tab strip: one <nav> of real buttons where the current step carries
 * `aria-current="step"`, so the state is exposed to assistive technology and
 * not by colour alone.
 */
export const StepNav: React.FC<StepNavProps> = ({
  steps,
  active,
  onSelect,
  label = 'Steps',
  className = '',
}) => {
  const classes = ['sas-steps', className].filter(Boolean).join(' ');

  return (
    <nav className={classes} aria-label={label}>
      {steps.map((step) => {
        const isActive = step.id === active;
        const stepClasses = ['sas-steps__step', isActive ? 'sas-steps__step--active' : '']
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={step.id}
            type="button"
            className={stepClasses}
            aria-current={isActive ? 'step' : undefined}
            disabled={step.disabled}
            onClick={() => onSelect(step.id)}
          >
            {step.label}
          </button>
        );
      })}
    </nav>
  );
};

export default StepNav;
