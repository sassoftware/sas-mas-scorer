// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDecision, getDecisionRevision } from '../../api/decisions';
import type { DecisionFlow, SidNodeData, Step } from '../../types/sid';
import FlowHeader from './FlowHeader';
import FlowDiagram from './FlowDiagram';
import FlowSidePanel from './FlowSidePanel';
import FlowCodeModal from './FlowCodeModal';
import WorkflowHistoryModal from './WorkflowHistoryModal';

interface FlowDetailPageProps {
  flowId: string;
}

export default function FlowDetailPage({ flowId: id }: FlowDetailPageProps) {
  const navigate = useNavigate();

  const [flow, setFlow] = useState<DecisionFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Sub-decision cache
  const [subDecisionCache] = useState<Map<string, DecisionFlow>>(new Map());
  const [subDecisionsLoading, setSubDecisionsLoading] = useState(false);

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
        fetchSubDecisions(data, subDecisionCache, 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSubDecisions(
    decision: DecisionFlow,
    cache: Map<string, DecisionFlow>,
    depth: number,
  ) {
    if (depth >= 3) return;
    const steps = decision.flow?.steps ?? [];
    const subDecisionUris = extractSubDecisionUris(steps);

    const newUris = subDecisionUris.filter((uri) => !cache.has(uri));
    if (newUris.length === 0) return;

    setSubDecisionsLoading(true);
    try {
      const results = await Promise.allSettled(
        newUris.map((uri) => getDecisionRevision(uri)),
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          cache.set(newUris[i], result.value);
          await fetchSubDecisions(result.value, cache, depth + 1);
        }
      }
      // Force re-render by updating flow
      setFlow((prev) => (prev ? { ...prev } : prev));
    } finally {
      setSubDecisionsLoading(false);
    }
  }

  const handleNodeClick = useCallback((nodeData: SidNodeData) => {
    setSelectedNode(nodeData);
  }, []);

  const handleViewCode = useCallback((href: string, language: string) => {
    setCodeModal({ href, language });
  }, []);

  if (loading) {
    return (
      <div className="flow-detail__loading">
        Loading decision flow...
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="flow-list__error">{error}</div>
        <button className="flow-detail__back" onClick={() => navigate('/flows')}>
          Back to list
        </button>
      </div>
    );
  }

  if (!flow) return null;

  return (
    <div className={`flow-detail${selectedNode ? ' flow-detail--panel-open' : ''}`}>
      <button className="flow-detail__back" onClick={() => navigate('/flows')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to list
      </button>

      <FlowHeader
        flow={flow}
        subDecisionCache={subDecisionCache}
        onShowWorkflowHistory={() => setShowWorkflowHistory(true)}
      />

      {subDecisionsLoading && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--sas-gray-400)', marginBottom: '8px' }}>
          Loading sub-decisions...
        </div>
      )}

      <FlowDiagram
        flow={flow}
        subDecisionCache={subDecisionCache}
        onNodeClick={handleNodeClick}
      />

      {selectedNode && (
        <FlowSidePanel
          nodeData={selectedNode}
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
