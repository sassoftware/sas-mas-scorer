// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDecision, getDecisionRevision } from '../../api/decisions';
import { getRestApiDefinitionByUri, REST_API_DEFINITION_TYPE, type RestApiDefinitionDetail } from '../../api/restApiDefinitions';
import { getRuleSetBundle, type RuleSetBundle } from '../../api/rulesets';
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
  // `cacheVersion` is bumped exactly once when all of them are complete, so
  // the diagram converts and lays out the graph once per load rather than
  // once per fetch phase.
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
    setLoading(true);
    setError('');
    setSelectedNode(null);

    getDecision(id)
      .then((data) => {
        setFlow(data);
        void loadReferences(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Sub-decisions first (the other two collect references from them), then
   * REST API definitions and rule sets together; publish the caches once.
   * The `finally` runs even if one tail rejects, so the other's cache still
   * reaches the diagram.
   */
  async function loadReferences(decision: DecisionFlow) {
    setReferencesLoading(true);
    try {
      await fetchSubDecisions(decision);
      await Promise.allSettled([fetchRestApiDefinitions(decision), fetchRuleSets(decision)]);
    } finally {
      setReferencesLoading(false);
      setCacheVersion((v) => v + 1);
    }
  }

  /**
   * Breadth-first: one request burst per nesting level, deduplicated against
   * the cache, so sibling subtrees load together and a grandchild shared by
   * two children is fetched once.
   */
  async function fetchSubDecisions(decision: DecisionFlow) {
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
    }
  }

  /** Fetch the REST API definitions used by the decision and its sub-decisions. */
  async function fetchRestApiDefinitions(decision: DecisionFlow) {
    const uris = new Set(collectCustomObjectUris(decision.flow?.steps ?? [], REST_API_DEFINITION_TYPE));
    for (const sub of subDecisionCache.values()) {
      for (const uri of collectCustomObjectUris(sub.flow?.steps ?? [], REST_API_DEFINITION_TYPE)) {
        uris.add(uri);
      }
    }
    const newUris = [...uris].filter((uri) => !restApiCache.has(uri));
    if (newUris.length === 0) return;

    const results = await Promise.allSettled(newUris.map((uri) => getRestApiDefinitionByUri(uri)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') restApiCache.set(newUris[i], result.value);
    });
  }

  /** Fetch the rule sets used by the decision and its sub-decisions. */
  async function fetchRuleSets(decision: DecisionFlow) {
    const ids = new Set(collectRuleSetIds(decision.flow?.steps ?? []));
    for (const sub of subDecisionCache.values()) {
      for (const rsId of collectRuleSetIds(sub.flow?.steps ?? [])) ids.add(rsId);
    }
    const newIds = [...ids].filter((rsId) => !ruleSetCache.has(rsId));
    if (newIds.length === 0) return;

    const results = await Promise.allSettled(newIds.map((rsId) => getRuleSetBundle(rsId)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') ruleSetCache.set(newIds[i], result.value);
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
