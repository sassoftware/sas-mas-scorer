// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Alert } from '../common/Alert';
import { PreflightAction } from '../../types/rulesImport';

export interface ConfirmEntry {
  name: string;
  folderPath: string;
  action: PreflightAction;
  existingRevision?: string;
}

interface ImportConfirmDialogProps {
  entries: ConfirmEntry[];
  /** e.g. "all 5 rule sets" or "3 previously rejected rule sets" */
  scopeLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACTION_BADGE: Record<PreflightAction, { label: string; variant: 'success' | 'warning' | 'default' }> = {
  create: { label: 'CREATE', variant: 'success' },
  update: { label: 'UPDATE', variant: 'warning' },
  unknown: { label: 'UNKNOWN', variant: 'default' },
};

export const ImportConfirmDialog: React.FC<ImportConfirmDialogProps> = ({
  entries,
  scopeLabel,
  onConfirm,
  onCancel,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const updateCount = entries.filter((e) => e.action === 'update' || e.action === 'unknown').length;
  const needsAck = updateCount > 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="rules-import__overlay" onClick={onCancel}>
      <div className="rules-import__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="rules-import__dialog-header">
          <h3>Import rule sets</h3>
          <button className="rules-import__dialog-close" onClick={onCancel} title="Close" type="button">
            &times;
          </button>
        </div>
        <div className="rules-import__dialog-body">
          <p className="rules-import__dialog-intro">This import will send {scopeLabel} to SAS Intelligent Decisioning:</p>
          <ul className="rules-import__confirm-list">
            {entries.map((entry) => {
              const badge = ACTION_BADGE[entry.action];
              return (
                <li key={`${entry.folderPath}|${entry.name}`} className="rules-import__confirm-item">
                  <Badge variant={badge.variant} size="small">{badge.label}</Badge>
                  <span className="rules-import__confirm-name">{entry.name}</span>
                  <span className="rules-import__confirm-folder">{entry.folderPath}</span>
                  {entry.action === 'update' && entry.existingRevision && (
                    <span className="rules-import__confirm-rev">current rev {entry.existingRevision}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {needsAck && (
            <>
              <Alert variant="warning">
                {updateCount === 1
                  ? 'One rule set already exists (or could not be checked) — importing replaces its content with a new unlocked revision.'
                  : `${updateCount} rule sets already exist (or could not be checked) — importing replaces their content with new unlocked revisions.`}
              </Alert>
              <label className="rules-import__confirm-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I understand that {updateCount === 1 ? 'an existing rule set' : `${updateCount} existing rule sets`} will be updated.
                </span>
              </label>
            </>
          )}
        </div>
        <div className="rules-import__dialog-footer">
          <Button variant="tertiary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={needsAck && !acknowledged}>
            Import
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ImportConfirmDialog;
