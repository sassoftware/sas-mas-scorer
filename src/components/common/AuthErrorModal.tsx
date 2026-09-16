// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { Alert } from './Alert';

// TLS/certificate failures surfaced by Node in the Electron main process
const CERT_ERROR_RE = /certificat|CERT_|SSL|TLS/i;

/** Fired when the auth-error modal wants the connection settings opened; App listens. */
export const OPEN_SETTINGS_EVENT = 'mas-scorer:open-settings';

interface AuthErrorModalProps {
  error: string;
  operation: 'login' | 'logout';
  onClose: () => void;
  /** When provided, shows a shortcut button into the connection settings */
  onOpenSettings?: () => void;
}

/**
 * Modal shown when a login/logout attempt fails — most importantly the
 * self-signed-certificate case, where the user gets concrete steps for
 * fixing their connection profile instead of a silent console error.
 */
export const AuthErrorModal: React.FC<AuthErrorModalProps> = ({
  error,
  operation,
  onClose,
  onOpenSettings,
}) => {
  const isCertError = CERT_ERROR_RE.test(error);

  const title = isCertError
    ? 'Could not connect securely'
    : operation === 'login' ? 'Login failed' : 'Logout failed';

  return (
    // elevated: this dialog can open while the connection-settings modal is up
    <Modal
      title={title}
      onClose={onClose}
      elevated
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Close
          </Button>
          {onOpenSettings && (
            <Button variant="primary" onClick={onOpenSettings}>
              Open Connection Settings
            </Button>
          )}
        </>
      }
    >
      {isCertError ? (
        <>
          <p style={{ margin: '0 0 12px' }}>
            The connection to the server failed because it presents a self-signed or
            untrusted SSL certificate, and this connection profile requires certificate
            verification.
          </p>
          <p style={{ margin: '0 0 8px' }}>To connect anyway:</p>
          <ol style={{ margin: '0 0 12px', paddingLeft: '20px', lineHeight: 1.7 }}>
            <li>Open <strong>Connection Settings</strong> (gear icon in the header)</li>
            <li>Click <strong>Edit</strong> on this connection</li>
            <li>Check <strong>Skip SSL certificate verification</strong></li>
            <li>Save the connection and log in again</li>
          </ol>
          <Alert variant="warning">
            Skipping certificate verification weakens the security of the connection —
            only do this for development or test environments you trust.
          </Alert>
        </>
      ) : (
        <p style={{ margin: '0 0 12px' }}>
          {operation === 'login'
            ? 'The login attempt did not complete. Check that the server URL and client credentials in your connection profile are correct, then try again.'
            : 'The logout attempt did not complete. Your session may still be active — try again.'}
        </p>
      )}
      <p style={{ margin: '12px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--sas-text-muted)', fontFamily: 'var(--font-family-mono)', wordBreak: 'break-word' }}>
        {error}
      </p>
    </Modal>
  );
};

export default AuthErrorModal;
