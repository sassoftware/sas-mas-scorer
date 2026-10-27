// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { decisionCacheKey, decisionUri, getDecision, getDecisionRevision } from '../../api/decisions';
import {
  getRestApiDefinitionByUri, restApiDefinitionCacheKey, REST_API_DEFINITION_TYPE, type RestApiDefinitionDetail,
} from '../../api/restApiDefinitions';
import { getRuleSetBundle, ruleSetBundleCacheKey, type RuleSetBundle } from '../../api/rulesets';
import { subscribeRequestCache } from '../../api/requestCache';
import { collectCustomObjectUris, collectRuleSetIds, extractSteps } from '../../utils/classify';
import { ViyaApiError } from '../../utils/apiErrors';
import type { DecisionFlow, SidNodeData, Step } from '../../types/sid';
import {
  buildVariableUsageIndex, graphUsageNodes, traceRoles, variableKey, type TraceRole,
} from '../../flow/variableUsage';
import { Alert, Button, CopyFailureDetails, Loading } from '../common';
import FlowHeader from './FlowHeader';
import FlowDiagram, { type DiagramGraph, type FocusRequest, type SelectVia } from './FlowDiagram';
import FlowSidePanel from './FlowSidePanel';
import FlowCodeModal from './FlowCodeModal';
import WorkflowHistoryModal from './WorkflowHistoryModal';
import { finderEntries } from './FlowNodeFinder';
import { TraceSummaryBar, type TraceInfo, type TraceListItem } from './VariableTrace';

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

/** A referenced object the page could not load. */
interface LoadFailure {
  /** Sub-decision URI, rule set id or REST API definition URI. */
  ref: string;
  kind: 'Sub-decision' | 'Rule set' | 'REST API definition';
  name: string;
  message: string;
}

function failureMessage(reason: unknown): string {
  if (reason instanceof ViyaApiError && reason.status !== undefined) {
    return reason.message.includes(String(reason.status)) ? reason.message : `HTTP ${reason.status}: ${reason.message}`;
  }
  return reason instanceof Error ? reason.message : String(reason);
}

/** The names the flows give their sub-decisions, rule sets and custom objects, by URI or id. */
function referenceNames(flows: DecisionFlow[]): Map<string, string> {
  const names = new Map<string, string>();
  const visit = (steps: Step[]) => {
    for (const step of steps) {
      if (step.customObject?.uri) names.set(step.customObject.uri, step.customObject.name);
      if (step.ruleset?.id) names.set(step.ruleset.id, step.ruleset.name);
      for (const pn of step.nodes ?? []) if (pn.uri) names.set(pn.uri, pn.name);
      visit(extractSteps(step.onTrue));
      visit(extractSteps(step.onFalse));
      visit(step.steps ?? []);
      for (const bc of step.branchCases ?? []) visit(extractSteps(bc.onTrue));
      visit(extractSteps(step.defaultCase));
      for (const tc of step.abTestCases ?? []) visit(extractSteps(tc.onTrue));
    }
  };
  for (const f of flows) visit(f.flow?.steps ?? []);
  return names;
}

/** The node whose details are open: its id at selection time and its data. */
interface Selection {
  id: string;
  data: SidNodeData;
}

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

  // References that could not be loaded. The diagram marks their nodes
  // "Unavailable" for as long as they stay here; the alert can be dismissed.
  const [loadFailures, setLoadFailures] = useState<LoadFailure[]>([]);
  const [failuresDismissed, setFailuresDismissed] = useState(false);
  // The flow id the running loads belong to, so a retry's late answers for a
  // flow the user has left are ignored.
  const currentIdRef = useRef(id);
  currentIdRef.current = id;

  // Side panel: the selected node and the traced variable.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [tracedVariable, setTracedVariable] = useState<string | null>(null);

  // What the diagram drew; the variable index and the jump lists use it.
  const [graph, setGraph] = useState<DiagramGraph | null>(null);

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
    setSelection(null);
    setFocusRequest(null);
    setTracedVariable(null);
    setLoadFailures([]);
    setFailuresDismissed(false);

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
        void loadReferences(updated, () => currentIdRef.current === id);
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
   * Rejected reads are collected into `loadFailures` as they settle.
   */
  async function loadReferences(decision: DecisionFlow, isActive: () => boolean) {
    setReferencesLoading(true);
    const tails: Promise<void>[] = [];
    // Set when a badge lands in a cache the diagram has not been told about.
    let badgesPending = false;
    const markBadge = () => { badgesPending = true; };
    const onFailed = (kind: LoadFailure['kind'], refs: string[], reasons: unknown[]) => {
      if (!isActive() || refs.length === 0) return;
      const names = referenceNames([decision, ...subDecisionCache.values()]);
      const added = refs.map((ref, i) => ({ ref, kind, name: names.get(ref) ?? ref, message: failureMessage(reasons[i]) }));
      setLoadFailures((prev) => [...prev.filter((f) => !refs.includes(f.ref)), ...added]);
      setFailuresDismissed(false);
    };
    const startTails = (flows: DecisionFlow[]) => {
      tails.push(fetchRestApiDefinitions(flows, markBadge, onFailed), fetchRuleSets(flows, markBadge, onFailed));
    };
    try {
      startTails([decision]);
      await fetchSubDecisions(decision, startTails, onFailed);
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

  type FailureSink = (kind: LoadFailure['kind'], refs: string[], reasons: unknown[]) => void;

  /** Rejected results of one allSettled burst, as parallel lists of refs and reasons. */
  function rejected<T>(refs: string[], results: PromiseSettledResult<T>[]): [string[], unknown[]] {
    const failedRefs: string[] = [];
    const reasons: unknown[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        failedRefs.push(refs[i]);
        reasons.push(result.reason);
      }
    });
    return [failedRefs, reasons];
  }

  /**
   * Breadth-first: one request burst per nesting level, deduplicated against
   * the cache, so sibling subtrees load together and a grandchild shared by
   * two children is fetched once. `onLevel` gets every level as it arrives.
   */
  async function fetchSubDecisions(
    decision: DecisionFlow, onLevel: (flows: DecisionFlow[]) => void, onFailed: FailureSink,
  ) {
    let frontier: DecisionFlow[] = [decision];
    for (let depth = 0; depth < MAX_SUB_DECISION_DEPTH && frontier.length > 0; depth++) {
      // Levels already in the cache are walked too (without a request), so a
      // retry or a refresh reaches what failed further down.
      const uris = new Set<string>();
      const cached = new Set<DecisionFlow>();
      for (const f of frontier) {
        for (const uri of extractSubDecisionUris(f.flow?.steps ?? [])) {
          const known = subDecisionCache.get(uri);
          if (known) cached.add(known);
          else uris.add(uri);
        }
      }
      const newUris = [...uris];
      if (newUris.length === 0 && cached.size === 0) return;

      const results = await Promise.allSettled(newUris.map((uri) => getDecisionRevision(uri)));
      frontier = [...cached];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          subDecisionCache.set(newUris[i], result.value);
          frontier.push(result.value);
        }
      });
      onFailed('Sub-decision', ...rejected(newUris, results));
      if (frontier.length > 0) onLevel(frontier);
    }
  }

  /** Fetch the REST API definitions used by these flows. */
  async function fetchRestApiDefinitions(flows: DecisionFlow[], onLoaded: () => void, onFailed: FailureSink) {
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
    onFailed('REST API definition', ...rejected(newUris, results));
  }

  /** Fetch the rule sets used by these flows. */
  async function fetchRuleSets(flows: DecisionFlow[], onLoaded: () => void, onFailed: FailureSink) {
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
    onFailed('Rule set', ...rejected(newIds, results));
  }

  /** Read the failed references again; what loaded before is kept. */
  const handleRetry = () => {
    if (!flow) return;
    const flowId = id;
    setLoadFailures([]);
    setFailuresDismissed(false);
    void loadReferences(flow, () => currentIdRef.current === flowId);
  };

  const unavailableRefs = useMemo(() => new Set(loadFailures.map((f) => f.ref)), [loadFailures]);

  /* ---- Selection, variable trace ---- */

  const panelOpen = !!selection || !!tracedVariable;

  const handleNodeSelect = useCallback((data: SidNodeData, nodeId: string, via: SelectVia) => {
    let mode: FocusRequest['mode'];
    if (via === 'find' || via === 'jump') mode = 'fit';
    else if (!panelOpen) mode = 'center';
    else mode = 'reveal';
    setSelection({ id: nodeId, data });
    setFocusRequest((prev) => ({ id: nodeId, mode, seq: (prev?.seq ?? 0) + 1 }));
  }, [panelOpen]);

  // Node ids are positions in the converted graph, so they move when
  // sub-decisions expand; follow the selected node by its step and label.
  const selectedId = useMemo(() => {
    if (!selection || !graph) return selection?.id ?? null;
    const same = (n: { data: SidNodeData }) => n.data.step === selection.data.step && n.data.label === selection.data.label;
    const atId = graph.nodes.find((n) => n.id === selection.id);
    if (atId && same(atId)) return atId.id;
    return graph.nodes.find(same)?.id ?? null;
  }, [selection, graph]);

  const handleTraceVariable = useCallback((name: string) => {
    setTracedVariable((current) => (current && variableKey(current) === variableKey(name) ? null : name));
  }, []);
  const clearTrace = useCallback(() => setTracedVariable(null), []);

  const closePanel = useCallback(() => {
    if (selection) setSelection(null);
    else setTracedVariable(null);
  }, [selection]);
  // Escape undoes the latest layer first: the trace, then the node details.
  const escapePanel = useCallback(() => {
    if (tracedVariable) setTracedVariable(null);
    else setSelection(null);
  }, [tracedVariable]);

  const usageIndex = useMemo(() => {
    if (!graph || !flow) return null;
    void cacheVersion; // rule sets fill the cache in place
    const signatures = [flow.signature ?? [], ...[...subDecisionCache.values()].map((f) => f.signature ?? [])];
    return buildVariableUsageIndex(graphUsageNodes(graph.nodes), signatures, ruleSetCache);
  }, [graph, flow, subDecisionCache, ruleSetCache, cacheVersion]);

  const roles = useMemo<ReadonlyMap<string, TraceRole> | null>(
    () => (tracedVariable && usageIndex ? traceRoles(usageIndex, tracedVariable) : null),
    [tracedVariable, usageIndex],
  );

  const trace = useMemo<TraceInfo | null>(() => {
    if (!tracedVariable || !roles || !graph) return null;
    const usage = usageIndex?.byVariable.get(variableKey(tracedVariable));
    const info: TraceInfo = { variable: usage?.name ?? tracedVariable, logic: [], mapped: [], notChecked: [] };
    for (const entry of finderEntries(graph.nodes, graph.groups)) {
      const role = roles.get(entry.id);
      if (!role) continue;
      const item: TraceListItem = { id: entry.id, label: entry.label, typeLabel: entry.typeLabel, path: entry.path, role };
      if (role === 'unknown') info.notChecked.push(item);
      else if (role.startsWith('mapped')) info.mapped.push(item);
      else info.logic.push(item);
    }
    return info;
  }, [tracedVariable, roles, graph, usageIndex]);

  const handleJumpToNode = useCallback((nodeId: string) => {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (node) handleNodeSelect(node.data, node.id, 'jump');
  }, [graph, handleNodeSelect]);

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

  const failureCount = loadFailures.length;

  return (
    <div className={`flow-detail${panelOpen ? ' flow-detail--panel-open' : ''}`}>
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
        tracedVariable={tracedVariable}
        onTraceVariable={handleTraceVariable}
      />

      {referencesLoading && (
        <p className="flow-detail__loading-hint" role="status">
          Loading sub-decisions and referenced objects...
        </p>
      )}

      {failureCount > 0 && !failuresDismissed && (
        <div className="flow-detail__alert">
          <Alert
            variant="warning"
            title={`${failureCount} referenced object${failureCount === 1 ? '' : 's'} could not be loaded`}
            dismissible
            onClose={() => setFailuresDismissed(true)}
            actions={(
              <>
                <Button variant="secondary" size="small" onClick={handleRetry} loading={referencesLoading} disabled={referencesLoading}>
                  Retry
                </Button>
                <CopyFailureDetails message={loadFailures[0].message} />
              </>
            )}
          >
            <p className="flow-detail__failure-intro">
              Their nodes are marked &ldquo;Unavailable&rdquo;: a sub-decision is not expanded and a rule set or
              REST API node has no badges, so the diagram may be missing parts of this decision.
            </p>
            <ul className="flow-detail__failure-list">
              {loadFailures.map((f) => (
                <li key={f.ref}>
                  <strong>{f.kind}</strong> {f.name}: {f.message}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <FlowDiagram
        flow={flow}
        subDecisionCache={subDecisionCache}
        restApiCache={restApiCache}
        ruleSetCache={ruleSetCache}
        cacheVersion={cacheVersion}
        unavailableRefs={unavailableRefs}
        selectedId={selectedId}
        focusRequest={focusRequest}
        traceRoles={roles}
        toolbarExtra={trace ? <TraceSummaryBar trace={trace} onClear={clearTrace} /> : null}
        onNodeSelect={handleNodeSelect}
        onGraphChange={setGraph}
      />

      {panelOpen && (
        <FlowSidePanel
          nodeData={selection?.data ?? null}
          nodeId={selectedId}
          restApiCache={restApiCache}
          ruleSetCache={ruleSetCache}
          onClose={closePanel}
          onEscape={escapePanel}
          onViewCode={handleViewCode}
          trace={trace}
          onTraceVariable={handleTraceVariable}
          onClearTrace={clearTrace}
          onJumpToNode={handleJumpToNode}
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
