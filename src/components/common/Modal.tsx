// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useRef } from 'react';
import { IconButton } from './IconButton';

export type ModalSize = 'small' | 'medium' | 'large' | 'wide';

interface ModalProps {
  /** Heading shown in the header; also the dialog's accessible name. */
  title: React.ReactNode;
  /** Called on Escape, on the close button, and on a click on the scrim. */
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons for the bottom bar; omit for no footer. */
  footer?: React.ReactNode;
  /** small 400px · medium 560px · large 720px · wide 960px */
  size?: ModalSize;
  /** Stack this modal above another open modal (auth error over settings). */
  elevated?: boolean;
  /** Set false for dialogs that must be dismissed deliberately (default true). */
  closeOnBackdropClick?: boolean;
  /** Hide the header's X button (default shown). */
  showCloseButton?: boolean;
  /** Element to focus on open; defaults to the dialog itself. */
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, innermost last — only the top one answers Escape.
const openModals: symbol[] = [];

/**
 * True while a modal dialog is open. Other Escape handlers (the layout
 * drawer, the flow side panel) call this to stay out of the way of an open
 * dialog.
 *
 * It answers for <Modal> from the mount stack, and falls back to the DOM for
 * dialogs that are still hand-rolled overlays (ShareDialog) and therefore
 * never register here. Drop the DOM half once every dialog is a <Modal>.
 */
export const isAnyModalOpen = (): boolean =>
  openModals.length > 0 ||
  (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null);

/**
 * Accessible dialog: owns the scrim, the z-index layer, Escape-to-close,
 * focus on open / restore on close, and a Tab trap. Mount it conditionally
 * (`{open && <Modal …/>}`); there is no `open` prop.
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  onClose,
  children,
  footer,
  size = 'medium',
  elevated = false,
  closeOnBackdropClick = true,
  showCloseButton = true,
  initialFocusRef,
  className = '',
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const instance = useRef(Symbol('modal'));
  // Latest onClose, read at keydown time so an inline-arrow prop never
  // re-registers the modal (which would move it back to the top of the stack).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus management: move focus in on open, give it back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const target = initialFocusRef?.current ?? dialogRef.current;
    target?.focus();
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Focus only on mount; a changing ref must not re-steal focus while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the topmost modal only. Registered once per mount so the
  // stack order reflects mount order, not the parents' render order.
  useEffect(() => {
    const id = instance.current;
    openModals.push(id);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openModals[openModals.length - 1] !== id) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openModals.indexOf(id);
      if (index !== -1) openModals.splice(index, 1);
    };
  }, []);

  // Keep Tab inside the dialog.
  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const backdropClasses = ['sas-modal-backdrop', elevated ? 'sas-modal-backdrop--elevated' : '']
    .filter(Boolean)
    .join(' ');
  const dialogClasses = ['sas-modal', `sas-modal--${size}`, className].filter(Boolean).join(' ');

  return (
    <div
      className={backdropClasses}
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={dialogClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="sas-modal__header">
          <h2 className="sas-modal__title" id={titleId}>
            {title}
          </h2>
          {showCloseButton && (
            <IconButton size="medium" aria-label="Close dialog" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IconButton>
          )}
        </div>
        <div className="sas-modal__body">{children}</div>
        {footer && <div className="sas-modal__footer">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;
