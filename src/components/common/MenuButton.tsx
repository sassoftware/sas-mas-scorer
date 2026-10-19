// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  id: string;
  label: React.ReactNode;
  /** A second, muted line under the label. */
  description?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Set on every item to make the menu a single-choice list (menuitemradio). */
  checked?: boolean;
}

interface MenuButtonProps {
  /** Visible trigger content. */
  label: React.ReactNode;
  /** Accessible name when the visible label is not enough (an icon, a value). */
  ariaLabel?: string;
  items: MenuItem[];
  /** Classes for the trigger; defaults to a small secondary button. */
  triggerClassName?: string;
  /** Right-align the menu under the trigger. */
  alignEnd?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

const CHEVRON = (
  <svg className="sas-menu-button__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * A button that opens a list of actions (WAI-ARIA menu button): Enter, Space
 * or ArrowDown open it on the first item, ArrowUp on the last; arrows, Home
 * and End move between items; Escape closes it and returns focus to the
 * trigger; Tab or a click outside closes it.
 */
export const MenuButton: React.FC<MenuButtonProps> = ({
  label,
  ariaLabel,
  items,
  triggerClassName = 'sas-button sas-button--secondary sas-button--small',
  alignEnd = false,
  disabled = false,
  title,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const radio = items.some((i) => i.checked !== undefined);

  const enabled = items.map((i, n) => (i.disabled ? -1 : n)).filter((n) => n >= 0);

  const openAt = useCallback((which: 'first' | 'last' | 'checked') => {
    const checkedIndex = items.findIndex((i) => i.checked && !i.disabled);
    const target =
      which === 'checked' && checkedIndex >= 0 ? checkedIndex
        : which === 'last' ? enabled[enabled.length - 1]
          : enabled[0];
    setFocusIndex(target ?? 0);
    setOpen(true);
  }, [items, enabled]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  // A pointer press outside closes the menu without stealing focus back.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(focusIndex);
    setFocusIndex(enabled[(pos + delta + enabled.length) % enabled.length]);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt(radio ? 'checked' : 'first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setFocusIndex(enabled[0] ?? 0); break;
      case 'End': e.preventDefault(); setFocusIndex(enabled[enabled.length - 1] ?? 0); break;
      // Stop Escape here so it closes only the menu, not a dialog or panel around it.
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      case 'Tab': setOpen(false); break;
      default: break;
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  return (
    <div ref={rootRef} className={`sas-menu-button ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt(radio ? 'checked' : 'first'))}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
        {CHEVRON}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={`sas-menu-button__menu${alignEnd ? ' sas-menu-button__menu--end' : ''}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, n) => (
            <button
              key={item.id}
              ref={(el) => { itemRefs.current[n] = el; }}
              type="button"
              role={radio ? 'menuitemradio' : 'menuitem'}
              aria-checked={radio ? !!item.checked : undefined}
              aria-disabled={item.disabled || undefined}
              tabIndex={n === focusIndex ? 0 : -1}
              className={`sas-menu-button__item${item.checked ? ' sas-menu-button__item--checked' : ''}`}
              onClick={() => select(item)}
            >
              <span className="sas-menu-button__item-label">{item.label}</span>
              {item.description && <span className="sas-menu-button__item-desc">{item.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MenuButton;
