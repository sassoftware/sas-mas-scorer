// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId, useRef } from 'react';
import { IconButton } from './IconButton';

interface SearchInputBaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Called after the clear button empties the field (onChange('') is always called). */
  onClear?: () => void;
}

/** Either a visible label (with an optional id) or an aria-label is required. */
type SearchInputLabelProps =
  | { label: string; id?: string; 'aria-label'?: never }
  | { 'aria-label': string; id?: string; label?: never };

export type SearchInputProps = SearchInputBaseProps & SearchInputLabelProps;

/**
 * Controlled search field with a leading magnifier and a trailing clear
 * button (shown only while there is text). Renders a <label> when `label`
 * is given; otherwise the field is named by `aria-label`.
 */
export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  autoFocus = false,
  className = '',
  onClear,
  label,
  id,
  'aria-label': ariaLabel,
}) => {
  const generatedId = useId();
  const inputId = id ?? `sas-search-${generatedId}`;
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange('');
    onClear?.();
    inputRef.current?.focus();
  };

  const classes = ['sas-search', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {label && (
        <label className="sas-search__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="sas-search__field">
        <svg
          className="sas-search__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          className="sas-search__input sas-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-label={label ? undefined : ariaLabel}
          autoComplete="off"
        />
        {value !== '' && !disabled && (
          <IconButton
            size="small"
            className="sas-search__clear"
            aria-label="Clear search"
            onClick={handleClear}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  );
};

export default SearchInput;
