// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import DeepLink from '../flows/FlowDeepLink';
import { ImportedRuleChain } from './ImportedRuleChain';
import { buildRuleSetDeepLink } from '../../utils/deepLinks';
import { ImportOutcome, RuleSetGroup } from '../../types/rulesImport';

/** Where an accepted rule set now lives on the server. */
export interface ImportedRuleSetLink {
  id?: string;
  /** "major.minor" after the import, when known. */
  revision?: string;
  /** Set when several rule sets share the name and the link may pick the wrong one. */
  ambiguity?: string;
}

interface ImportResultPanelProps {
  outcome: ImportOutcome;
  groups: RuleSetGroup[];
  /** Rows edited since the import — shows "edited" chips on rejected sets. */
  editedRows: Set<number>;
  /** Link target per accepted rule-set key. */
  links: Map<string, ImportedRuleSetLink>;
  /** True while the ids / revisions are still being looked up. */
  resolvingLinks: boolean;
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
  links,
  resolvingLinks,
  onRetryRejected,
  onDownloadRejected,
  onDownloadResponse,
  retryDisabledReason,
}) => {
  const rejectedCount = outcome.rejectedKeys.length;
  const acceptedCount = outcome.acceptedKeys.length;
  // The accepted rule set whose rule chain is shown below the list.
  const [chainKey, setChainKey] = useState<string | null>(null);
  const chainLink = chainKey !== null ? links.get(chainKey) : undefined;
  const chainGroup = chainKey !== null ? groups.find((g) => g.key === chainKey) : undefined;

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
            {outcome.acceptedKeys.map((key) => {
              const link = links.get(key);
              const deepLink = link?.id ? buildRuleSetDeepLink(link.id) : null;
              const label = displayName(groups, key);
              const showing = chainKey === key;
              return (
                <li key={key}>
                  <Badge variant="success" size="small">imported</Badge>{' '}
                  {label}
                  {link?.revision && <span className="rules-import__result-meta">revision {link.revision}</span>}
                  {link?.id ? (
                    <>
                      {deepLink && <DeepLink url={deepLink.url} label={deepLink.label} showLabel />}
                      <button
                        type="button"
                        className="rules-import__link-button"
                        aria-expanded={showing}
                        aria-controls={showing ? 'rules-import-chain' : undefined}
                        onClick={() => setChainKey(showing ? null : key)}
                      >
                        {showing ? 'Hide rules' : 'Show rules'}
                      </button>
                    </>
                  ) : (
                    <span className="rules-import__result-meta">
                      {resolvingLinks ? 'Looking up the rule set…' : 'Not found by name and folder; open it from SAS Intelligent Decisioning.'}
                    </span>
                  )}
                  {link?.ambiguity && (
                    <span className="rules-import__result-meta rules-import__result-meta--warning">
                      {link.ambiguity}; the link opens the first match.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Alert>
      )}

      {chainKey !== null && chainLink?.id && (
        <div id="rules-import-chain">
          <ImportedRuleChain ruleSetId={chainLink.id} name={chainGroup?.name ?? chainKey} />
        </div>
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
