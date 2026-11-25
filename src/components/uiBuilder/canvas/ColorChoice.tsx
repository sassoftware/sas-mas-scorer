// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId } from 'react';
import { ENV_COLOR_PRESETS } from '../../../utils/envColor';
import { safeColor } from '../../../utils/uiDefaults';
import { ColorSwatch } from '../../common/ColorSwatch';

/** SAS blue, the first choice in Connection Settings' environment colours too. */
const SAS_BLUE = '#0766D1';

interface Props {
  label: string;
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  /**
   * 'button': the first swatch is the standard SAS blue (no colour stored).
   * 'line': the first swatch is "No line", and SAS blue is a colour like the others.
   */
  kind: 'button' | 'line';
  hint?: string;
}

/**
 * The same quick colours as the environment colour in Connection Settings
 * (SAS blue, Light Blue, Midnight Blue, Pink) and a custom colour.
 */
export const ColorChoice: React.FC<Props> = ({ label, value, onChange, kind, hint }) => {
  const id = useId();
  const current = safeColor(value)?.toUpperCase();
  const presets = kind === 'line'
    ? [{ name: 'SAS blue', value: SAS_BLUE }, ...ENV_COLOR_PRESETS]
    : ENV_COLOR_PRESETS;
  const isPreset = !current || presets.some(p => p.value.toUpperCase() === current);
  return (
    <div className="ui-builder__config-field">
      <span className="cb-inspector__label" id={`${id}-label`}>{label}</span>
      <div className="connection-settings__swatches">
        <div className="connection-settings__swatch-group" role="radiogroup" aria-labelledby={`${id}-label`}>
          <ColorSwatch
            group={id}
            name={kind === 'button' ? 'Standard (SAS blue)' : 'No line'}
            value={SAS_BLUE}
            none={kind === 'line'}
            checked={!current}
            onSelect={() => onChange(undefined)}
          />
          {presets.map(p => (
            <ColorSwatch
              key={p.value}
              group={id}
              name={p.name}
              value={p.value}
              checked={current === p.value.toUpperCase()}
              onSelect={() => onChange(p.value)}
            />
          ))}
        </div>
        <label
          className={`connection-settings__custom-color${isPreset ? '' : ' connection-settings__custom-color--active'}`}
          title="Custom colour"
        >
          <input
            type="color"
            className="connection-settings__custom-color-input"
            aria-label={`${label}: custom colour`}
            value={(current ?? SAS_BLUE).toLowerCase()}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="connection-settings__hint">Custom</span>
        </label>
      </div>
      {hint && <p className="ui-builder__config-type-hint">{hint}</p>}
    </div>
  );
};
