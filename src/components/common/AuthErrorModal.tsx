// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from 'react';
import { Button } from './Button';
import { Card, CardHeader, CardBody, CardFooter } from './Card';
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ maxWidth: '560px', width: '100%', margin: '24px', color: 'var(--sas-gray-900, #1a1a1a)' }}>
        <Card padding="none">
          <CardHeader>
            <h3>
              {isCertError
                ? 'Could not connect securely'
                : operation === 'login' ? 'Login failed' : 'Logout failed'}
            </h3>
          </CardHeader>
          <CardBody>
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
            <p style={{ margin: '12px 0 0', fontSize: '12px', color: 'var(--sas-gray-500, #888)', fontFamily: 'var(--font-family-mono, monospace)', wordBreak: 'break-word' }}>
              {error}
            </p>
          </CardBody>
          <CardFooter>
            <Button variant="tertiary" onClick={onClose}>
              Close
            </Button>
            {onOpenSettings && (
              <Button variant="primary" onClick={onOpenSettings}>
                Open Connection Settings
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default AuthErrorModal;
