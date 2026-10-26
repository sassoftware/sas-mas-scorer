// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { copyText, findRecordedFailure, formatFailureReport, RecordedFailure } from '../../utils/apiErrors';

export type AlertVariant = 'success' | 'warning' | 'error' | 'info';

interface AlertProps {
  children: React.ReactNode;
  variant?: AlertVariant;
  title?: string;
  onClose?: () => void;
  dismissible?: boolean;
  /**
   * Controls shown on the alert's own row, after the message — a Retry
   * button, a link. Use this instead of wrapping the children in a
   * feature-specific flex row.
   */
  actions?: React.ReactNode;
}

/**
 * The failed SAS Viya request behind an error alert, found by its message in
 * the API client's list of recent failures, so views need not pass the error
 * object through. Re-checked when the content changes: the alert's text can
 * change while it stays mounted.
 */
const useRecordedFailure = (
  messageRef: React.RefObject<HTMLDivElement>,
  content: React.ReactNode,
  enabled: boolean
): RecordedFailure | undefined => {
  const [failure, setFailure] = useState<RecordedFailure | undefined>(undefined);
  useEffect(() => {
    const found = enabled ? findRecordedFailure(messageRef.current?.textContent ?? '') : undefined;
    if (found !== failure) setFailure(found);
  }, [messageRef, content, enabled, failure]);
  return failure;
};

/**
 * "Copy details" on an error alert that shows a failed request: the message
 * with the HTTP status, SAS error code, request path, time, app version and
 * build — what an administrator or a support ticket needs.
 */
const CopyErrorDetails: React.FC<{ messageRef: React.RefObject<HTMLDivElement>; failure: RecordedFailure }> = ({
  messageRef,
  failure,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 4000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    const report = formatFailureReport(messageRef.current?.textContent ?? failure.message, failure);
    setCopyState((await copyText(report)) ? 'copied' : 'failed');
  };

  // The label itself confirms the copy: it sits inside the alert's live
  // region, so screen readers announce the change as well.
  return (
    <Button variant="tertiary" size="small" onClick={handleCopy}>
      {copyState === 'copied' ? 'Details copied' : copyState === 'failed' ? 'Copy blocked by the browser' : 'Copy details'}
    </Button>
  );
};

/**
 * The same "Copy details" for error states that are not an Alert (an
 * EmptyState, say): renders nothing unless `message` is a recorded failure.
 */
export const CopyFailureDetails: React.FC<{ message: string }> = ({ message }) => {
  const messageRef = useRef<HTMLDivElement>(null);
  const failure = findRecordedFailure(message);
  if (!failure) return null;
  return (
    <>
      <div ref={messageRef} hidden>{message}</div>
      <CopyErrorDetails messageRef={messageRef} failure={failure} />
    </>
  );
};

export const Alert: React.FC<AlertProps> = ({
  children,
  variant = 'info',
  title,
  onClose,
  dismissible = false,
  actions,
}) => {
  const messageRef = useRef<HTMLDivElement>(null);
  const failure = useRecordedFailure(messageRef, children, variant === 'error');
  const icons: Record<AlertVariant, React.ReactNode> = {
    success: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div className={`sas-alert sas-alert--${variant}`} role="alert">
      <div className="sas-alert__icon">{icons[variant]}</div>
      <div className="sas-alert__content">
        {title && <h4 className="sas-alert__title">{title}</h4>}
        <div className="sas-alert__message" ref={messageRef}>{children}</div>
      </div>
      {(actions || failure) && (
        <div className="sas-alert__actions">
          {actions}
          {failure && <CopyErrorDetails messageRef={messageRef} failure={failure} />}
        </div>
      )}
      {dismissible && onClose && (
        <IconButton size="small" className="sas-alert__close" onClick={onClose} aria-label="Close alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </IconButton>
      )}
    </div>
  );
};

export default Alert;
