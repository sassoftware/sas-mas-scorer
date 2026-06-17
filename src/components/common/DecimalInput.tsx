// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';

interface DecimalInputProps {
  id?: string;
  className?: string;
  value: unknown;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Parse user text into a number, accepting comma or dot as the decimal mark. */
export function parseDecimal(raw: string): number | null {
  if (raw.trim() === '') return null;
  const normalized = raw.replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

/**
 * Controlled decimal input that preserves exactly what the user types — including
 * a trailing separator or zeros ("3.", "3.0", "3,02") — instead of round-tripping
 * through parseFloat on every keystroke, which truncated in-progress values (e.g.
 * typing the 0 in "3.0" collapsed back to "3"). Accepts both "." and "," as the
 * decimal separator and emits a number (or null) to the parent while keeping its
 * own text for display.
 */
export const DecimalInput: React.FC<DecimalInputProps> = ({
  id,
  className = 'sas-input',
  value,
  onChange,
  disabled,
  placeholder,
}) => {
  const [text, setText] = useState(
    value !== null && value !== undefined ? String(value) : ''
  );

  // Sync from external value changes (form reset, load scenario, etc.) only when
  // the incoming number differs from what's already typed, so we never clobber an
  // in-progress entry like "3.0" whose numeric value (3) still matches the model.
  useEffect(() => {
    const incoming = value !== null && value !== undefined ? Number(value) : null;
    const current = parseDecimal(text);
    if (incoming !== current) {
      setText(incoming !== null && !Number.isNaN(incoming) ? String(incoming) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(parseDecimal(raw));
      }}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
};

export default DecimalInput;
