// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from 'react';
import { Button } from '../common/Button';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  // Visual variant for the confirm button. Destructive actions use 'danger'
  // so the button is red and the user has a moment to think twice.
  confirmVariant?: 'primary' | 'danger';
  // True while the underlying action is in flight; buttons are disabled and
  // the confirm button shows a spinner. Backdrop / ESC are also no-ops so
  // the user can't accidentally dismiss mid-flight.
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  busy = false,
  error,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [busy, onCancel]);

  return (
    <div
      className="confirm-dialog__backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h3>
        <div className="confirm-dialog__message">{message}</div>
        {error && <div className="confirm-dialog__error">{error}</div>}
        <div className="confirm-dialog__actions">
          <Button variant="tertiary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
