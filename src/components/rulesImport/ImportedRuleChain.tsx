// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Alert } from '../common/Alert';
import { getRuleSetBundle } from '../../api/rulesets';
import { buildRuleSetView, type RuleElementView, type RuleSetView } from '../../utils/ruleSetView';

interface ImportedRuleChainProps {
  ruleSetId: string;
  name: string;
}

/** One condition or action line (same visual language as the flow side panel). */
function ChainLine({ element, lead }: { element: RuleElementView; lead: string }) {
  return (
    <div className={`flow-sp-rule__line${element.invalid ? ' flow-sp-rule__line--invalid' : ''}`}>
      <span className="flow-sp-rule__lead">{lead}</span>
      <span className="flow-sp-rule__expr">{element.text || '—'}</span>
      <span className="flow-sp-rule__kind">{element.kind}</span>
      {element.invalid && element.message && <span className="flow-sp-rule__msg">{element.message}</span>}
    </div>
  );
}

/**
 * The rule chain of a just-imported rule set, read back from the server, so
 * the user can check what SAS Intelligent Decisioning now holds (including
 * anything it flags as invalid) without leaving the import page.
 */
export const ImportedRuleChain: React.FC<ImportedRuleChainProps> = ({ ruleSetId, name }) => {
  const [view, setView] = useState<RuleSetView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError(null);
    getRuleSetBundle(ruleSetId)
      .then((bundle) => {
        if (!cancelled) setView(buildRuleSetView(bundle.rules));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the rule set.');
      });
    return () => {
      cancelled = true;
    };
  }, [ruleSetId]);

  return (
    <section className="rules-import__chain" aria-label={`Rules of ${name}`} aria-busy={view === null && error === null}>
      {error && <Alert variant="error">Could not read the rules of {name}: {error}</Alert>}
      {!error && view === null && <p className="rules-import__chain-status" role="status">Loading the rules…</p>}
      {view && (
        <>
          <p className="rules-import__chain-status" role="status">
            {view.rules.length} rule{view.rules.length === 1 ? '' : 's'} on the server
            {view.invalidCount > 0 && `, ${view.invalidCount} element${view.invalidCount === 1 ? '' : 's'} reported invalid`}
          </p>
          <ol className="rules-import__chain-list">
            {view.rules.map((rule) => (
              <li
                key={rule.id ?? rule.sequence}
                className={`flow-sp-card flow-sp-rule${rule.invalidCount > 0 ? ' flow-sp-rule--invalid' : ''}`}
              >
                <div className="flow-sp-card__title">
                  <span className="flow-sp-rule__seq" aria-hidden="true">{rule.sequence}</span>
                  {rule.name}
                  {rule.tracked && <span className="flow-sp-rule__tracked">tracked</span>}
                </div>
                {rule.message && <div className="flow-sp-rule__msg">{rule.message}</div>}
                {rule.conditions.map((condition, i) => (
                  <ChainLine key={`c${i}`} element={condition} lead={i === 0 ? rule.keyword : 'AND'} />
                ))}
                {rule.conditions.length === 0 && rule.keyword === 'ELSE' && (
                  <div className="flow-sp-rule__line">
                    <span className="flow-sp-rule__lead">ELSE</span>
                  </div>
                )}
                {rule.actions.map((action, i) => (
                  <ChainLine key={`a${i}`} element={action} lead={i === 0 ? 'THEN' : 'AND'} />
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
};

export default ImportedRuleChain;
