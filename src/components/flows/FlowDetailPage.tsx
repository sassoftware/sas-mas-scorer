// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { decisionCacheKey, decisionUri, getDecision, getDecisionRevision } from '../../api/decisions';
import {
  getRestApiDefinitionByUri, restApiDefinitionCacheKey, REST_API_DEFINITION_TYPE, type RestApiDefinitionDetail,
} from '../../api/restApiDefinitions';
import { getRuleSetBundle, ruleSetBundleCacheKey, type RuleSetBundle } from '../../api/rulesets';
import { subscribeRequestCache } from '../../api/requestCache';
import { collectCustomObjectUris, collectRuleSetIds } from '../../utils/classify';
import type { DecisionFlow, SidNodeData, Step } from '../../types/sid';
import { Alert, Button, Loading } from '../common';
import FlowHeader from './FlowHeader';
import FlowDiagram from './FlowDiagram';
import FlowSidePanel from './FlowSidePanel';
import FlowCodeModal from './FlowCodeModal';
import WorkflowHistoryModal from './WorkflowHistoryModal';

interface FlowDetailPageProps {
  flowId: string;
}

/** Nesting levels of sub-decisions to fetch; the diagram expands the same depth. */
const MAX_SUB_DECISION_DEPTH = 3;

const BACK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

export default function FlowDetailPage({ flowId: id }: FlowDetailPageProps) {
  const navigate = useNavigate();

  const [flow, setFlow] = useState<DecisionFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The three caches are mutable Maps with stable identity. They are filled
  // in the background after the decision itself has rendered, and
  // `cacheVersion` is bumped when the sub-decisions are all in (the diagram
  // lays out the expanded graph once) and again only if rule set or REST API
  // badges arrive after that (the diagram patches them in without a new
  // layout). The reads behind them go through the session request cache, so
  // opening a flow again, or a flow sharing sub-decisions and rule sets with
  // one opened before, is served from memory.
  const [subDecisionCache] = useState<Map<string, DecisionFlow>>(new Map());
  const [restApiCache] = useState<Map<string, RestApiDefinitionDetail>>(new Map());
  const [ruleSetCache] = useState<Map<string, RuleSetBundle>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  const [referencesLoading, setReferencesLoading] = useState(false);

  // Side panel
  const [selectedNode, setSelectedNode] = useState<SidNodeData | null>(null);

  // Code modal
  const [codeModal, setCodeModal] = useState<{ href: string; language: string } | null>(null);

  // Workflow history modal
  const [showWorkflowHistory, setShowWorkflowHistory] = useState(false);

  // Fetch main decision
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError('');
    setSelectedNode(null);

    getDecision(id)
      .then((data) => {
        if (!active) return;
        setFlow(data);
        void loadReferences(data, () => active);
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A document shown from the session cache is refreshed in the background
  // once it is older than a minute; when SAS Intelligent Decisioning has a
  // newer version, put it on screen.
  useEffect(() => {
    if (!id) return;
    const flowKey = decisionCacheKey(decisionUri(id));
    return subscribeRequestCache((key, value) => {
      if (key === flowKey) {
        const updated = value as DecisionFlow;
        setFlow(updated);
        void loadReferences(updated, () => true);
        return;
      }
      let changed = false;
      for (const uri of subDecisionCache.keys()) {
        if (key === decisionCacheKey(uri)) {
          subDecisionCache.set(uri, value as DecisionFlow);
          changed = true;
        }
      }
      for (const rsId of ruleSetCache.keys()) {
        if (key === ruleSetBundleCacheKey(rsId)) {
          ruleSetCache.set(rsId, value as RuleSetBundle);
          changed = true;
        }
      }
      for (const uri of restApiCache.keys()) {
        if (key === restApiDefinitionCacheKey(uri)) {
          restApiCache.set(uri, value as RestApiDefinitionDetail);
          changed = true;
        }
      }
      if (changed) setCacheVersion((v) => v + 1);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Pipelined: the sub-decisions are read breadth-first, and the rule sets and
   * REST API definitions of every level are requested as soon as that level
   * has arrived instead of after the last one. The expanded structure is
   * published once when the sub-decisions are complete; badges that arrive
   * later are published with one more bump. The `finally` runs even if a
   * request rejects, so whatever did load still reaches the diagram.
   */
  async function loadReferences(decision: DecisionFlow, isActive: () => boolean) {
    setReferencesLoading(true);
    const tails: Promise<void>[] = [];
    // Set when a badge lands in a cache the diagram has not been told about.
    let badgesPending = false;
    const markBadge = () => { badgesPending = true; };
    const startTails = (flows: DecisionFlow[]) => {
      tails.push(fetchRestApiDefinitions(flows, markBadge), fetchRuleSets(flows, markBadge));
    };
    try {
      startTails([decision]);
      await fetchSubDecisions(decision, startTails);
    } finally {
      if (isActive()) {
        badgesPending = false;
        setCacheVersion((v) => v + 1);
      }
    }
    try {
      await Promise.allSettled(tails);
    } finally {
      if (isActive()) {
        setReferencesLoading(false);
        if (badgesPending) setCacheVersion((v) => v + 1);
      }
    }
  }

  /**
   * Breadth-first: one request burst per nesting level, deduplicated against
   * the cache, so sibling subtrees load together and a grandchild shared by
   * two children is fetched once. `onLevel` gets every level as it arrives.
   */
  async function fetchSubDecisions(decision: DecisionFlow, onLevel: (flows: DecisionFlow[]) => void) {
    let frontier: DecisionFlow[] = [decision];
    for (let depth = 0; depth < MAX_SUB_DECISION_DEPTH && frontier.length > 0; depth++) {
      const uris = new Set<string>();
      for (const f of frontier) {
        for (const uri of extractSubDecisionUris(f.flow?.steps ?? [])) {
          if (!subDecisionCache.has(uri)) uris.add(uri);
        }
      }
      const newUris = [...uris];
      if (newUris.length === 0) return;

      const results = await Promise.allSettled(newUris.map((uri) => getDecisionRevision(uri)));
      frontier = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          subDecisionCache.set(newUris[i], result.value);
          frontier.push(result.value);
        }
      });
      if (frontier.length > 0) onLevel(frontier);
    }
  }

  /** Fetch the REST API definitions used by these flows. */
  async function fetchRestApiDefinitions(flows: DecisionFlow[], onLoaded: () => void) {
    const uris = new Set<string>();
    for (const f of flows) {
      for (const uri of collectCustomObjectUris(f.flow?.steps ?? [], REST_API_DEFINITION_TYPE)) {
        if (!restApiCache.has(uri)) uris.add(uri);
      }
    }
    const newUris = [...uris];
    if (newUris.length === 0) return;

    const results = await Promise.allSettled(newUris.map((uri) => getRestApiDefinitionByUri(uri)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        restApiCache.set(newUris[i], result.value);
        onLoaded();
      }
    });
  }

  /** Fetch the rule sets used by these flows. */
  async function fetchRuleSets(flows: DecisionFlow[], onLoaded: () => void) {
    const ids = new Set<string>();
    for (const f of flows) {
      for (const rsId of collectRuleSetIds(f.flow?.steps ?? [])) {
        if (!ruleSetCache.has(rsId)) ids.add(rsId);
      }
    }
    const newIds = [...ids];
    if (newIds.length === 0) return;

    const results = await Promise.allSettled(newIds.map((rsId) => getRuleSetBundle(rsId)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        ruleSetCache.set(newIds[i], result.value);
        onLoaded();
      }
    });
  }

  const handleNodeClick = useCallback((nodeData: SidNodeData) => {
    setSelectedNode(nodeData);
  }, []);

  const handleViewCode = useCallback((href: string, language: string) => {
    setCodeModal({ href, language });
  }, []);

  if (loading) {
    return <Loading message="Loading decision flow..." />;
  }

  if (error) {
    return (
      <div className="flow-detail">
        <div className="flow-detail__alert">
          <Alert variant="error">{error}</Alert>
        </div>
        <Button variant="tertiary" size="small" icon={BACK_ICON} onClick={() => navigate('/flows')}>
          Back to list
        </Button>
      </div>
    );
  }

  if (!flow) return null;

  return (
    <div className={`flow-detail${selectedNode ? ' flow-detail--panel-open' : ''}`}>
      <Button
        variant="tertiary"
        size="small"
        icon={BACK_ICON}
        className="flow-detail__back"
        onClick={() => navigate('/flows')}
      >
        Back to list
      </Button>

      <FlowHeader
        flow={flow}
        subDecisionCache={subDecisionCache}
        restApiCache={restApiCache}
        ruleSetCache={ruleSetCache}
        onShowWorkflowHistory={() => setShowWorkflowHistory(true)}
      />

      {referencesLoading && (
        <p className="flow-detail__loading-hint" role="status">
          Loading sub-decisions and referenced objects...
        </p>
      )}

      <FlowDiagram
        flow={flow}
        subDecisionCache={subDecisionCache}
        restApiCache={restApiCache}
        ruleSetCache={ruleSetCache}
        cacheVersion={cacheVersion}
        onNodeClick={handleNodeClick}
      />

      {selectedNode && (
        <FlowSidePanel
          nodeData={selectedNode}
          restApiCache={restApiCache}
          ruleSetCache={ruleSetCache}
          onClose={() => setSelectedNode(null)}
          onViewCode={handleViewCode}
        />
      )}

      {codeModal && (
        <FlowCodeModal
          href={codeModal.href}
          language={codeModal.language}
          onClose={() => setCodeModal(null)}
        />
      )}

      {showWorkflowHistory && flow && (
        <WorkflowHistoryModal
          decisionId={flow.id}
          workflowName={flow.properties?.workflowName as string | undefined}
          onClose={() => setShowWorkflowHistory(false)}
        />
      )}
    </div>
  );
}

/** Recursively extract all sub-decision URIs from steps */
function extractSubDecisionUris(steps: Step[]): string[] {
  const uris: string[] = [];
  for (const step of steps) {
    if (step.customObject?.type === 'decision') {
      uris.push(step.customObject.uri);
    }
    if (step.nodes) {
      for (const pn of step.nodes) {
        if (pn.uri) uris.push(pn.uri);
      }
    }
    if (step.onTrue) {
      uris.push(...extractSubDecisionUris(extractBranchSteps(step.onTrue)));
    }
    if (step.onFalse) {
      uris.push(...extractSubDecisionUris(extractBranchSteps(step.onFalse)));
    }
    if (step.steps) {
      uris.push(...extractSubDecisionUris(step.steps));
    }
    if (step.branchCases) {
      for (const bc of step.branchCases) {
        if (bc.onTrue) {
          uris.push(...extractSubDecisionUris(extractBranchSteps(bc.onTrue)));
        }
      }
    }
    if (step.defaultCase) {
      uris.push(...extractSubDecisionUris(extractBranchSteps(step.defaultCase)));
    }
    if (step.abTestCases) {
      for (const tc of step.abTestCases) {
        if (tc.onTrue) {
          uris.push(...extractSubDecisionUris(extractBranchSteps(tc.onTrue)));
        }
      }
    }
  }
  return uris;
}

function extractBranchSteps(branch: unknown): Step[] {
  if (!branch) return [];
  if (typeof branch === 'object' && branch !== null) {
    if ('steps' in branch && Array.isArray((branch as { steps: unknown }).steps)) {
      return (branch as { steps: Step[] }).steps;
    }
    if (Array.isArray(branch)) return branch as Step[];
    return [branch as Step];
  }
  return [];
}
