// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// "Score this decision": the way from a decision (the flow page, the flow
// list, a Test Coverage row) to the scorer, through the MAS module the
// decision was published as. Shared by the flows and coverage views; the
// styles are in coverage.css.
//
// What the UI may claim: "published as <module>" comes from the completed
// publish records (modelPublish); a Score action is offered only for a module
// MAS was found to have (or, when MAS could not be asked, worded as
// unchecked).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  findMasModuleForDecision,
  findMasModulesForDecisions,
  masModuleRoute,
  type DecisionMasModuleIndex,
  type DecisionMasModules,
} from '../../api/modelPublish';
import { formatTimestamp } from '../../utils/formatters';

export interface DecisionMasIndexState {
  /** Null until loaded (or when the lookup failed). */
  index: DecisionMasModuleIndex | null;
  loading: boolean;
  error: string | null;
}

/**
 * The MAS modules of every published decision, for a list. One modelPublish
 * query plus one MAS module listing, cached for the session (see
 * findMasModulesForDecisions).
 */
export function useDecisionMasIndex(enabled = true): DecisionMasIndexState {
  const [state, setState] = useState<DecisionMasIndexState>({ index: null, loading: false, error: null });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState((prev) => ({ ...prev, loading: prev.index === null, error: null }));
    findMasModulesForDecisions()
      .then((index) => {
        if (active) setState({ index, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({ index: null, loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return state;
}

/** The MAS module of one decision; undefined while it is being looked up. */
export function useDecisionMasModule(flowId: string | undefined): {
  modules: DecisionMasModules | null | undefined;
  error: string | null;
} {
  const [result, setResult] = useState<{
    flowId?: string;
    modules: DecisionMasModules | null | undefined;
    error: string | null;
  }>({ modules: undefined, error: null });
  useEffect(() => {
    if (!flowId) return;
    let active = true;
    findMasModuleForDecision(flowId)
      .then((modules) => {
        if (active) setResult({ flowId, modules, error: null });
      })
      .catch((err: unknown) => {
        if (active) setResult({ flowId, modules: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      active = false;
    };
  }, [flowId]);
  // An answer for the previous flow is never shown for this one.
  return result.flowId === flowId ? result : { modules: undefined, error: null };
}

/** The play-in-circle icon the Publishing Overview uses for "Execute Score". */
export const ScoreIcon: React.FC<{ className?: string; size?: number }> = ({ className, size }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
  </svg>
);

const WARNING_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </svg>
);

const NONE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </svg>
);

const names = (list: { publishName: string }[]): string => list.map((p) => p.publishName).join(', ');

interface FlowScoreActionProps {
  flowId: string;
  /** The flow's last change, to say when it was modified after the module was published. */
  flowModifiedTimeStamp?: string;
}

/**
 * The flow page's "Published to MAS as <module> — Score" action. Says so
 * when the flow has no completed MAS publish, when the published module is
 * no longer in MAS, and when the flow was modified after the publish (the
 * module then runs the revision published at that time).
 */
export const FlowScoreAction: React.FC<FlowScoreActionProps> = ({ flowId, flowModifiedTimeStamp }) => {
  const { modules, error } = useDecisionMasModule(flowId);

  // Nothing while looking up: the lookup takes a few seconds and the header
  // must not jump. A failed lookup is not a finding about the flow.
  if (modules === undefined || error) return null;

  if (!modules) {
    return (
      <span className="decision-mas decision-mas--none">
        {NONE_ICON}
        Not published to MAS
      </span>
    );
  }

  const { latest, others, removed, verified } = modules;

  if (!latest) {
    return (
      <span className="decision-mas decision-mas--none">
        {WARNING_ICON}
        Published to MAS as {names(removed)}, but MAS no longer has {removed.length === 1 ? 'that module' : 'those modules'}
      </span>
    );
  }

  const modifiedAfter =
    !!flowModifiedTimeStamp &&
    (Date.parse(flowModifiedTimeStamp) || 0) > (Date.parse(latest.publishedAt) || 0);

  return (
    <div className="decision-mas">
      <Link
        to={masModuleRoute(latest.publishName)}
        className="sas-button sas-button--secondary sas-button--small decision-mas__score"
        title={`Open the scorer for MAS module ${latest.publishName}, published ${formatTimestamp(latest.publishedAt)}`}
      >
        <ScoreIcon size={16} />
        <span>
          Published to MAS as <strong className="decision-mas__name">{latest.publishName}</strong> — Score
        </span>
      </Link>
      {!verified && (
        <span className="decision-mas__note">
          {WARNING_ICON}
          From the publish history; MAS could not be asked whether the module still exists.
        </span>
      )}
      {modifiedAfter && (
        <span className="decision-mas__note">
          {WARNING_ICON}
          Published {formatTimestamp(latest.publishedAt)}; the flow has been modified since, so the module runs
          the revision published then.
        </span>
      )}
      {others.length > 0 && (
        <span className="decision-mas__others">
          Also published as{' '}
          {others.map((o, i) => (
            <React.Fragment key={o.publishName}>
              {i > 0 && ', '}
              <Link to={masModuleRoute(o.publishName)} title={`Published ${formatTimestamp(o.publishedAt)}`}>
                {o.publishName}
              </Link>
            </React.Fragment>
          ))}
        </span>
      )}
      {removed.length > 0 && (
        <span className="decision-mas__others">
          Earlier module{removed.length === 1 ? '' : 's'} no longer in MAS: {names(removed)}
        </span>
      )}
    </div>
  );
};
