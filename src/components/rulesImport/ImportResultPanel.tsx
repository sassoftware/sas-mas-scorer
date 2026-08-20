// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { ImportOutcome, RuleSetGroup } from '../../types/rulesImport';

interface ImportResultPanelProps {
  outcome: ImportOutcome;
  groups: RuleSetGroup[];
  /** Rows edited since the import — shows "edited" chips on rejected sets. */
  editedRows: Set<number>;
  onRetryRejected: () => void;
  onDownloadRejected: () => void;
  onDownloadResponse: () => void;
  retryDisabledReason: string | null;
}

const displayName = (groups: RuleSetGroup[], key: string): string => {
  const group = groups.find((g) => g.key === key);
  return group ? `${group.name} (${group.folderPath})` : key;
};

export const ImportResultPanel: React.FC<ImportResultPanelProps> = ({
  outcome,
  groups,
  editedRows,
  onRetryRejected,
  onDownloadRejected,
  onDownloadResponse,
  retryDisabledReason,
}) => {
  const rejectedCount = outcome.rejectedKeys.length;
  const acceptedCount = outcome.acceptedKeys.length;

  const groupEdited = (key: string): boolean => {
    const group = groups.find((g) => g.key === key);
    return group !== undefined && group.rowIndexes.some((r) => editedRows.has(r));
  };

  return (
    <div className="rules-import__result">
      {outcome.globalIssues.length > 0 && (
        <Alert variant="error" title="Global issues reported by the service">
          <ul className="rules-import__result-list">
            {outcome.globalIssues.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}

      {acceptedCount > 0 && (
        <Alert variant="success" title={`${acceptedCount} rule set${acceptedCount === 1 ? '' : 's'} imported successfully`}>
          <ul className="rules-import__result-list">
            {outcome.acceptedKeys.map((key) => (
              <li key={key}>
                <Badge variant="success" size="small">imported</Badge>{' '}
                {displayName(groups, key)}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {rejectedCount > 0 && (
        <Alert variant="error" title={`${rejectedCount} rule set${rejectedCount === 1 ? '' : 's'} rejected`}>
          <ul className="rules-import__result-list">
            {outcome.rejectedKeys.map((key) => (
              <li key={key}>
                <Badge variant="error" size="small">rejected</Badge>{' '}
                {displayName(groups, key)}
                {groupEdited(key) && <Badge variant="info" size="small">edited since rejection</Badge>}
              </li>
            ))}
          </ul>
          <p className="rules-import__result-hint">
            Rejected rows are highlighted in the grid above with the server&apos;s reasons — fix them and import again.
            Only the rejected rule sets are re-sent; accepted rule sets are not updated twice.
          </p>
        </Alert>
      )}

      {acceptedCount === 0 && rejectedCount === 0 && outcome.globalIssues.length === 0 && (
        <Alert variant="info">The service accepted the request but reported no rule sets — check the raw response.</Alert>
      )}

      <div className="rules-import__result-actions">
        {rejectedCount > 0 && (
          <Button variant="primary" onClick={onRetryRejected} disabled={retryDisabledReason !== null} title={retryDisabledReason ?? undefined}>
            Import again — rejected only ({rejectedCount})
          </Button>
        )}
        {rejectedCount > 0 && (
          <Button variant="secondary" onClick={onDownloadRejected}>
            Download rejected rows (CSV)
          </Button>
        )}
        <Button variant="tertiary" onClick={onDownloadResponse}>
          Download server response
        </Button>
      </div>
    </div>
  );
};

export default ImportResultPanel;
