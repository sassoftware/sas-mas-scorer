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
  /**
   * Makes the item a choice (menuitemradio) with a tick when true. Set on
   * every item for a single-choice menu, or on the items of one `group`.
   */
  checked?: boolean;
  /**
   * Consecutive items with the same group are drawn together under this
   * heading (role="group"), with a rule between groups.
   */
  group?: string;
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
  /** Leave out the trailing chevron (a ⋮ trigger). */
  hideChevron?: boolean;
  /**
   * Place the menu with fixed positioning so a scrolling or clipping parent
   * (a table wrapper) can't cut it off. It closes when the page scrolls.
   */
  floating?: boolean;
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
/** Runs of items that share a group, keeping each item's index for focus. */
function segments(items: MenuItem[]): { group?: string; items: { item: MenuItem; n: number }[] }[] {
  const out: { group?: string; items: { item: MenuItem; n: number }[] }[] = [];
  items.forEach((item, n) => {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push({ item, n });
    else out.push({ group: item.group, items: [{ item, n }] });
  });
  return out;
}

export const MenuButton: React.FC<MenuButtonProps> = ({
  label,
  ariaLabel,
  items,
  triggerClassName = 'sas-button sas-button--secondary sas-button--small',
  alignEnd = false,
  disabled = false,
  title,
  className = '',
  hideChevron = false,
  floating = false,
}) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<React.CSSProperties | undefined>(undefined);
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  // A menu made only of choices opens on the chosen one.
  const radio = items.length > 0 && items.every((i) => i.checked !== undefined);

  const enabled = items.map((i, n) => (i.disabled ? -1 : n)).filter((n) => n >= 0);

  const openAt = useCallback((which: 'first' | 'last' | 'checked') => {
    const checkedIndex = items.findIndex((i) => i.checked && !i.disabled);
    const target =
      which === 'checked' && checkedIndex >= 0 ? checkedIndex
        : which === 'last' ? enabled[enabled.length - 1]
          : enabled[0];
    setFocusIndex(target ?? 0);
    if (floating && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      setPlace({
        position: 'fixed',
        ...(below < 240 && r.top > below
          ? { bottom: window.innerHeight - r.top + 4, top: 'auto' }
          : { top: r.bottom + 4 }),
        ...(alignEnd
          ? { right: Math.max(8, window.innerWidth - r.right), left: 'auto' }
          : { left: Math.max(8, r.left) }),
      });
    }
    setOpen(true);
  }, [items, enabled, floating, alignEnd]);

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

  // A fixed menu would stay put while its trigger scrolls away.
  useEffect(() => {
    if (!open || !floating) return;
    const onMove = (e: Event) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, floating]);

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
        {!hideChevron && CHEVRON}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={`sas-menu-button__menu${alignEnd ? ' sas-menu-button__menu--end' : ''}`}
          style={floating ? place : undefined}
          onKeyDown={onMenuKeyDown}
        >
          {segments(items).map((seg, s) => {
            const buttons = seg.items.map(({ item, n }) => (
              <button
                key={item.id}
                ref={(el) => { itemRefs.current[n] = el; }}
                type="button"
                role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                aria-checked={item.checked !== undefined ? item.checked : undefined}
                aria-disabled={item.disabled || undefined}
                tabIndex={n === focusIndex ? 0 : -1}
                className={`sas-menu-button__item${item.checked ? ' sas-menu-button__item--checked' : ''}${item.checked !== undefined && !radio ? ' sas-menu-button__item--choice' : ''}`}
                onClick={() => select(item)}
              >
                <span className="sas-menu-button__item-label">{item.label}</span>
                {item.description && <span className="sas-menu-button__item-desc">{item.description}</span>}
              </button>
            ));
            return (
              <React.Fragment key={`${seg.group ?? ''}-${s}`}>
                {s > 0 && <div role="separator" className="sas-menu-button__separator" />}
                {seg.group ? (
                  <div role="group" aria-label={seg.group}>
                    <div className="sas-menu-button__heading" aria-hidden="true">{seg.group}</div>
                    {buttons}
                  </div>
                ) : buttons}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MenuButton;
