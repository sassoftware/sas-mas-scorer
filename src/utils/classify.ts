// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Step, SidNodeType } from '../types/sid';
import { CUSTOM_TYPE_MAP } from '../flow/constants';

export function classifyStep(step: Step): { nodeType: SidNodeType; label: string } {
  const stepType = step.type ?? '';

  if (stepType === 'application/vnd.sas.decision.step.variable.assignment' || step.assignments) {
    return { nodeType: 'assignment', label: step.name ?? 'Assignment' };
  }

  if (stepType === 'application/vnd.sas.decision.step.abtest' || step.abTestCases) {
    return { nodeType: 'abtest', label: step.name ?? 'A/B Test' };
  }

  if (stepType === 'application/vnd.sas.decision.step.parallel') {
    return { nodeType: 'parallel', label: step.name ?? 'Parallel Process' };
  }

  if (stepType === 'application/vnd.sas.decision.step.record.contact' || step.recordContact) {
    return { nodeType: 'record_contact', label: step.recordContact?.name ?? step.name ?? 'Record Contact' };
  }

  if (step.customObject) {
    const objType = step.customObject.type ?? '';
    let category = CUSTOM_TYPE_MAP[objType];
    if (!category) {
      category = (objType === 'decision') ? 'decision' : 'custom';
    }
    return { nodeType: category, label: step.customObject.name ?? 'Unknown' };
  }

  if (step.model) {
    const m = step.model;
    let name = m.name ?? 'Model';
    if (m.algorithmName && m.algorithmName !== name) {
      name = `${name} (${m.algorithmName})`;
    }
    return { nodeType: 'model', label: name };
  }

  if (step.ruleset) {
    return { nodeType: 'ruleset', label: step.ruleset.name ?? 'Rule Set' };
  }

  if (step.condition) {
    let name = step.name;
    if (!name) {
      const c = step.condition;
      const lhs = c.lhsTerm?.name ?? '?';
      const op = c.operator ?? '=';
      const rhsTerm = c.rhsTerm;
      const rhs = c.rhsConstant ?? (rhsTerm && typeof rhsTerm === 'object' ? rhsTerm.name : '?') ?? '?';
      name = `${lhs} ${op} ${rhs}`;
    }
    return { nodeType: 'condition', label: name };
  }

  if (step.branchCases && step.branchCases.length > 0) {
    return { nodeType: 'condition', label: step.name ?? 'Branch' };
  }

  if (step.conditionExpression) {
    return { nodeType: 'cond_expr', label: step.name ?? 'Condition' };
  }

  if (step.decisionNodeLinkTarget) {
    return { nodeType: 'unknown', label: '' };
  }

  return { nodeType: 'unknown', label: 'Unknown Step' };
}

export function extractSteps(branchData: unknown): Step[] {
  if (!branchData) return [];
  if (typeof branchData === 'object' && branchData !== null) {
    if ('steps' in branchData && Array.isArray((branchData as { steps: unknown }).steps)) {
      return (branchData as { steps: Step[] }).steps;
    }
    if (Array.isArray(branchData)) return branchData as Step[];
    return [branchData as Step];
  }
  return [];
}

export function buildConditionExpression(step: Step): string {
  if (!step.condition) return step.conditionExpression ?? '';
  const c = step.condition;
  const lhs = c.lhsTerm?.name ?? '?';
  const op = c.operator ?? '=';
  const rhsTerm = c.rhsTerm;
  const rhs = c.rhsConstant ?? (rhsTerm && typeof rhsTerm === 'object' ? rhsTerm.name : '?') ?? '?';
  return `${lhs} ${op} ${rhs}`;
}

export function buildBranchCaseExpression(bc: { simpleCondition?: Step['condition']; label?: string }): string {
  if (bc.simpleCondition) {
    const c = bc.simpleCondition;
    const lhs = c?.lhsTerm?.name ?? '?';
    const op = c?.operator ?? '=';
    const rhsTerm = c?.rhsTerm;
    const rhs = c?.rhsConstant ?? (rhsTerm && typeof rhsTerm === 'object' ? rhsTerm.name : '?') ?? '?';
    return `${lhs} ${op} ${rhs}`;
  }
  return bc.label ?? 'Case';
}
