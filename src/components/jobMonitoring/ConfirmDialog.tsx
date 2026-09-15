// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Modal } from '../common/Modal';
import { Alert } from '../common/Alert';
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
  // the confirm button shows a spinner. Backdrop / ESC / X are also no-ops so
  // the user can't accidentally dismiss mid-flight.
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// The chrome (scrim, z-index, Escape, focus trap, labelled dialog role) is
// the shared <Modal>; this component only supplies the copy and the buttons.
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
  const handleClose = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      title={title}
      size="small"
      onClose={handleClose}
      closeOnBackdropClick={!busy}
      footer={
        <>
          <Button variant="tertiary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-dialog__body">
        <div className="confirm-dialog__message">{message}</div>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Modal>
  );
};
