// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Node, Edge } from '@xyflow/react';
import type { Step, DecisionFlow, SidNodeData, SidNodeType } from '../types/sid';
import { classifyStep, extractSteps, buildConditionExpression, buildBranchCaseExpression } from '../utils/classify';

interface Pending {
  nodeId: string;
  edgeLabel: string;
}

export interface NodeGroup {
  id: string;
  label: string;
  type: 'sub-decision' | 'parallel';
  nodeIds: string[];
}

interface ConversionState {
  nodes: Node<SidNodeData>[];
  edges: Edge[];
  idCounter: number;
  linkTargets: Map<string, string>;
  linkLabels: Map<string, string>;
  subDecisionCache: Map<string, DecisionFlow>;
  depth: number;
  groups: NodeGroup[];
  activeGroupStack: NodeGroup[];
}

function nextId(state: ConversionState): string {
  return `n${state.idCounter++}`;
}

function beginGroup(state: ConversionState, label: string, type: 'sub-decision' | 'parallel'): NodeGroup {
  const group: NodeGroup = { id: `group-${state.groups.length}`, label, type, nodeIds: [] };
  state.groups.push(group);
  state.activeGroupStack.push(group);
  return group;
}

function endGroup(state: ConversionState): void {
  state.activeGroupStack.pop();
}

function addNode(
  state: ConversionState,
  id: string,
  nodeType: SidNodeType,
  label: string,
  step?: Step,
  extra?: Partial<SidNodeData>,
): void {
  state.nodes.push({
    id,
    type: nodeType === 'condition' || nodeType === 'cond_expr' ? 'condition' : nodeType,
    position: { x: 0, y: 0 },
    data: { label, nodeType, step, ...extra },
  });
  for (const group of state.activeGroupStack) {
    group.nodeIds.push(id);
  }
}

function addEdge(
  state: ConversionState,
  source: string,
  target: string,
  label?: string,
  dotted = false,
): void {
  state.edges.push({
    id: `e-${source}-${target}-${label ?? ''}`,
    source,
    target,
    label: label || undefined,
    type: 'smoothstep',
    style: dotted ? { strokeDasharray: '6 3', opacity: 0.7 } : undefined,
    animated: dotted,
    labelStyle: label === 'Yes'
      ? { fill: '#16a34a', fontWeight: 600, fontSize: 11 }
      : label === 'No'
        ? { fill: '#dc2626', fontWeight: 600, fontSize: 11 }
        : { fontSize: 11 },
  });
}

function connectPending(state: ConversionState, pending: Pending[], targetId: string): void {
  for (const p of pending) {
    addEdge(state, p.nodeId, targetId, p.edgeLabel);
  }
}

function processSteps(
  state: ConversionState,
  steps: Step[],
  initialPending: Pending[],
): { firstId: string | null; terminals: Pending[] } {
  let firstId: string | null = null;
  let pending = [...initialPending];

  for (const step of steps) {
    const { nodeType, label } = classifyStep(step);

    // Cross-branch link target
    if (step.decisionNodeLinkTarget) {
      const target = step.decisionNodeLinkTarget;
      const targetUuid = typeof target === 'string' ? target : target?.nodeId;
      if (targetUuid) {
        for (const p of pending) {
          state.linkTargets.set(`${p.nodeId}|${p.edgeLabel}`, targetUuid);
        }
        pending = [];
      }
      continue;
    }

    // A/B Test
    if (step.abTestCases && step.abTestCases.length > 0) {
      const abtestNid = nextId(state);
      addNode(state, abtestNid, 'abtest', step.name ?? 'A/B Test', step);
      if (step.linkLabel) state.linkLabels.set(step.linkLabel, abtestNid);
      connectPending(state, pending, abtestNid);
      if (!firstId) firstId = abtestNid;

      const branchTerminals: Pending[] = [];
      for (const tc of step.abTestCases) {
        const caseLabel = tc.label
          ? `${tc.label}${tc.percent != null ? ` (${tc.percent}%)` : ''}`
          : `${tc.percent ?? '?'}%`;
        const trueSteps = extractSteps(tc.onTrue);
        if (trueSteps.length > 0) {
          const result = processSteps(state, trueSteps, [{ nodeId: abtestNid, edgeLabel: caseLabel }]);
          branchTerminals.push(...result.terminals);
        } else {
          branchTerminals.push({ nodeId: abtestNid, edgeLabel: caseLabel });
        }
      }
      pending = branchTerminals;
      continue;
    }

    // Parallel process
    if (step.type === 'application/vnd.sas.decision.step.parallel' && step.nodes && step.nodes.length > 0) {
      beginGroup(state, step.name ?? 'Parallel Process', 'parallel');

      const forkNid = nextId(state);
      addNode(state, forkNid, 'parallel', `${step.name ?? 'Parallel Process'}`, step);
      if (step.linkLabel) state.linkLabels.set(step.linkLabel, forkNid);
      connectPending(state, pending, forkNid);
      if (!firstId) firstId = forkNid;

      const branchTerminals: Pending[] = [];
      for (const pn of step.nodes) {
        if (pn.uri && state.depth < 3 && state.subDecisionCache.has(pn.uri)) {
          const subFlow = state.subDecisionCache.get(pn.uri)!;
          const subSteps = subFlow.flow?.steps ?? [];

          if (subSteps.length > 0) {
            const entryNid = nextId(state);
            addNode(state, entryNid, 'decision', pn.name, step);
            addEdge(state, forkNid, entryNid, '');

            state.depth++;
            const result = processSteps(state, subSteps, [{ nodeId: entryNid, edgeLabel: '' }]);
            state.depth--;

            const exitNid = nextId(state);
            addNode(state, exitNid, 'decision', `End: ${pn.name}`);
            connectPending(state, result.terminals, exitNid);
            branchTerminals.push({ nodeId: exitNid, edgeLabel: '' });
          } else {
            const entryNid = nextId(state);
            addNode(state, entryNid, 'decision', pn.name, step);
            addEdge(state, forkNid, entryNid, '');
            branchTerminals.push({ nodeId: entryNid, edgeLabel: '' });
          }
        } else {
          const pnNid = nextId(state);
          addNode(state, pnNid, 'decision', pn.name, step);
          addEdge(state, forkNid, pnNid, '');
          branchTerminals.push({ nodeId: pnNid, edgeLabel: '' });
        }
      }

      const joinNid = nextId(state);
      addNode(state, joinNid, 'parallel', `End: ${step.name ?? 'Parallel'}`, step);
      connectPending(state, branchTerminals, joinNid);

      endGroup(state);
      pending = [{ nodeId: joinNid, edgeLabel: '' }];
      continue;
    }

    // Multi-way branch
    if (step.branchCases && step.branchCases.length > 0) {
      const branchTerminals: Pending[] = [];
      let currentPending = [...pending];

      for (let ci = 0; ci < step.branchCases.length; ci++) {
        const bc = step.branchCases[ci];
        const caseExpr = buildBranchCaseExpression(bc);
        const caseLabel = bc.label ?? caseExpr;

        const caseNid = nextId(state);
        const syntheticStep: Step = {
          ...step,
          id: bc.id,
          name: caseLabel,
          condition: bc.simpleCondition ?? undefined,
          branchCases: undefined,
          defaultCase: undefined,
        };
        addNode(state, caseNid, 'condition', caseExpr, syntheticStep, {
          expression: caseExpr,
        });
        connectPending(state, currentPending, caseNid);
        if (!firstId) firstId = caseNid;

        const trueSteps = extractSteps(bc.onTrue);
        if (trueSteps.length > 0) {
          const result = processSteps(state, trueSteps, [{ nodeId: caseNid, edgeLabel: 'Yes' }]);
          branchTerminals.push(...result.terminals);
        } else {
          branchTerminals.push({ nodeId: caseNid, edgeLabel: 'Yes' });
        }

        currentPending = [{ nodeId: caseNid, edgeLabel: 'No' }];
      }

      const defaultSteps = extractSteps(step.defaultCase);
      if (defaultSteps.length > 0) {
        const result = processSteps(state, defaultSteps, currentPending);
        branchTerminals.push(...result.terminals);
      } else {
        branchTerminals.push(...currentPending);
      }

      pending = branchTerminals;
      continue;
    }

    // Condition/branch node (binary)
    if (nodeType === 'condition' || nodeType === 'cond_expr') {
      const nid = nextId(state);
      addNode(state, nid, nodeType, label, step, {
        expression: buildConditionExpression(step),
      });
      if (step.linkLabel) state.linkLabels.set(step.linkLabel, nid);
      connectPending(state, pending, nid);
      if (!firstId) firstId = nid;

      const branchTerminals: Pending[] = [];

      const trueSteps = extractSteps(step.onTrue);
      if (trueSteps.length > 0) {
        const result = processSteps(state, trueSteps, [{ nodeId: nid, edgeLabel: 'Yes' }]);
        branchTerminals.push(...result.terminals);
      } else {
        branchTerminals.push({ nodeId: nid, edgeLabel: 'Yes' });
      }

      const falseSteps = extractSteps(step.onFalse);
      if (falseSteps.length > 0) {
        const result = processSteps(state, falseSteps, [{ nodeId: nid, edgeLabel: 'No' }]);
        branchTerminals.push(...result.terminals);
      } else {
        branchTerminals.push({ nodeId: nid, edgeLabel: 'No' });
      }

      pending = branchTerminals;
      continue;
    }

    // Nested steps block
    if (step.steps && step.steps.length > 0) {
      const result = processSteps(state, step.steps, pending);
      if (result.firstId) {
        if (!firstId) firstId = result.firstId;
        pending = result.terminals;
      }
      continue;
    }

    // Sub-decision expansion
    if (
      step.customObject?.type === 'decision' &&
      state.depth < 3 &&
      state.subDecisionCache.has(step.customObject.uri)
    ) {
      const subFlow = state.subDecisionCache.get(step.customObject.uri)!;
      const subSteps = subFlow.flow?.steps ?? [];

      if (subSteps.length > 0) {
        beginGroup(state, step.customObject.name, 'sub-decision');

        const entryNid = nextId(state);
        addNode(state, entryNid, 'decision', step.customObject.name, step);
        connectPending(state, pending, entryNid);
        if (!firstId) firstId = entryNid;

        state.depth++;
        const result = processSteps(state, subSteps, [{ nodeId: entryNid, edgeLabel: '' }]);
        state.depth--;

        const exitNid = nextId(state);
        addNode(state, exitNid, 'decision', `End: ${step.customObject.name}`);
        connectPending(state, result.terminals, exitNid);

        endGroup(state);
        pending = [{ nodeId: exitNid, edgeLabel: '' }];
      } else {
        const nid = nextId(state);
        addNode(state, nid, 'decision', label, step);
        if (step.linkLabel) state.linkLabels.set(step.linkLabel, nid);
        connectPending(state, pending, nid);
        if (!firstId) firstId = nid;
        pending = [{ nodeId: nid, edgeLabel: '' }];
      }
      continue;
    }

    // Regular node
    const nid = nextId(state);
    addNode(state, nid, nodeType, label, step);
    if (step.linkLabel) state.linkLabels.set(step.linkLabel, nid);
    connectPending(state, pending, nid);
    if (!firstId) firstId = nid;
    pending = [{ nodeId: nid, edgeLabel: '' }];
  }

  return { firstId, terminals: pending };
}

export function convertFlowToGraph(
  flow: DecisionFlow,
  subDecisionCache: Map<string, DecisionFlow> = new Map(),
): { nodes: Node<SidNodeData>[]; edges: Edge[]; groups: NodeGroup[] } {
  const steps = flow.flow?.steps ?? [];

  const state: ConversionState = {
    nodes: [],
    edges: [],
    idCounter: 0,
    linkTargets: new Map(),
    linkLabels: new Map(),
    subDecisionCache,
    depth: 0,
    groups: [],
    activeGroupStack: [],
  };

  const startId = nextId(state);
  addNode(state, startId, 'start', 'Start');

  if (steps.length === 0) {
    const endId = nextId(state);
    addNode(state, endId, 'end', 'End');
    addEdge(state, startId, endId);
    return { nodes: state.nodes, edges: state.edges, groups: state.groups };
  }

  const { terminals } = processSteps(state, steps, [{ nodeId: startId, edgeLabel: '' }]);

  const endId = nextId(state);
  addNode(state, endId, 'end', 'End');
  for (const t of terminals) {
    addEdge(state, t.nodeId, endId, t.edgeLabel);
  }

  // Resolve cross-branch links
  for (const [key, targetUuid] of state.linkTargets) {
    const [srcId, edgeLabel] = key.split('|');
    const targetNodeId = state.linkLabels.get(targetUuid);
    if (targetNodeId) {
      addEdge(state, srcId, targetNodeId, edgeLabel, true);
    } else {
      addEdge(state, srcId, endId, edgeLabel, true);
    }
  }

  return { nodes: state.nodes, edges: state.edges, groups: state.groups };
}
