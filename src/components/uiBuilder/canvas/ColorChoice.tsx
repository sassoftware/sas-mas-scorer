// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId } from 'react';
import { APP_COLORS, safeColor } from '../../../utils/uiDefaults';

interface Props {
  label: string;
  /** What "no colour" means here ("Standard blue", "No line"). */
  noneLabel: string;
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  hint?: string;
}

/** A row of colour swatches, a "none" choice and a custom colour picker. */
export const ColorChoice: React.FC<Props> = ({ label, noneLabel, value, onChange, hint }) => {
  const id = useId();
  const current = safeColor(value);
  const isPreset = !!current && APP_COLORS.some(c => c.value.toLowerCase() === current.toLowerCase());
  return (
    <div className="ui-builder__config-field">
      <span className="cb-inspector__label" id={`${id}-label`}>{label}</span>
      <div className="cb-colors" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          className={`cb-colors__swatch cb-colors__swatch--none${current ? '' : ' cb-colors__swatch--on'}`}
          aria-pressed={!current}
          aria-label={noneLabel}
          title={noneLabel}
          onClick={() => onChange(undefined)}
        />
        {APP_COLORS.map(c => {
          const on = !!current && current.toLowerCase() === c.value.toLowerCase();
          return (
            <button
              key={c.value}
              type="button"
              className={`cb-colors__swatch${on ? ' cb-colors__swatch--on' : ''}`}
              style={{ backgroundColor: c.value }}
              aria-pressed={on}
              aria-label={c.name}
              title={c.name}
              onClick={() => onChange(c.value)}
            />
          );
        })}
        <label className={`cb-colors__custom${current && !isPreset ? ' cb-colors__custom--on' : ''}`}>
          <input
            type="color"
            value={current ?? '#0766d1'}
            onChange={(e) => onChange(e.target.value)}
          />
          <span>Custom</span>
        </label>
      </div>
      {hint && <p className="ui-builder__config-type-hint">{hint}</p>}
    </div>
  );
};
