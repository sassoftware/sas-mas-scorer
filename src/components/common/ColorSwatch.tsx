// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface ColorSwatchProps {
  /** The radio group's name: one per group on the page. */
  group: string;
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  /** Draw a "none" swatch (a white circle with a slash) instead of the colour. */
  none?: boolean;
}

// A native radio gives the swatch its keyboard semantics, checked state and
// accessible name; the checkmark makes the selection visible without colour.
export const ColorSwatch: React.FC<ColorSwatchProps> = ({ group, name, value, checked, onSelect, none }) => (
  <label className="connection-settings__swatch" title={name}>
    <input
      type="radio"
      name={group}
      className="connection-settings__swatch-input"
      aria-label={name}
      checked={checked}
      onChange={onSelect}
    />
    <span
      className={`connection-settings__swatch-color${none ? ' connection-settings__swatch-color--none' : ''}`}
      style={none ? undefined : { background: value }}
      aria-hidden="true"
    >
      {checked && (
        <svg
          className="connection-settings__swatch-check"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  </label>
);
