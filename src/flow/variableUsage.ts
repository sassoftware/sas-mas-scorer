// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Where each decision variable is used — the index behind the diagram's
 * "Where <variable> is used" trace and the export's "Variable usage" table.
 *
 * This is static lineage from the decision's structured metadata, nothing
 * more. It never reads code (DS2, Python, SQL) or free-text expressions; what
 * SAS Intelligent Decisioning does not record as a term, the index does not
 * know. Three levels of knowledge:
 *
 * - **logic** — the node's own terms say it reads or writes the variable:
 *   rule set rules (condition terms, expression units, action terms, as
 *   buildRuleSetView collects them), branch conditions (lhsTerm / rhsTerm),
 *   assignment targets, record contact channel and treatment terms.
 * - **mapping** — only the step's decision-term ↔ step-term mapping is
 *   known (models, code files, sub-decisions, REST calls, treatments, custom
 *   nodes, and rule sets whose rules have not loaded). The node exchanges the
 *   variable with the decision; what it does with it inside is not visible.
 * - **opaque** — a node of that kind with no mappings: it may use the
 *   variable and the index cannot tell, so it is reported as "not checked"
 *   rather than "not used".
 *
 * Names are matched case-insensitively (SAS variable names are), and across
 * expanded sub-decisions by name.
 */

import type { SidNodeData, SidNodeType, SignatureVar, Step, StepMapping } from '../types/sid';
import type { RuleSetBundle } from '../api/rulesets';
import { ruleSetViewOf } from './ruleSetViewCache';

/** How a node takes part in a traced variable. */
export type TraceRole =
  | 'reads' | 'writes' | 'both'
  | 'mapped-in' | 'mapped-out' | 'mapped-both'
  | 'unknown';

/** Where a node's usage comes from (see the module comment). */
export type UsageSource = 'logic' | 'mapping' | 'none';

export interface NodeUsage {
  /** Variables taken in: read by logic, or mapped in. As first spelled. */
  reads: string[];
  /** Variables given out: written by logic, or mapped out. As first spelled. */
  writes: string[];
  source: UsageSource;
  /** The node may use variables the index cannot see (no mappings). */
  opaque: boolean;
}

export interface VariableUsage {
  /** The variable as first spelled (signature spelling wins). */
  name: string;
  /** Signature direction, when the variable is in a signature. */
  direction?: SignatureVar['direction'];
  /** Node ids with their part, in node order. */
  nodes: Array<{ id: string; role: Exclude<TraceRole, 'unknown'> }>;
}

export interface VariableUsageIndex {
  byNode: Map<string, NodeUsage>;
  /** Keyed by variableKey(name). */
  byVariable: Map<string, VariableUsage>;
  /** Ids of the nodes whose usage is not declared, in node order. */
  opaqueNodes: string[];
}

/** What the index needs of a node; React Flow nodes and export nodes both fit. */
export interface UsageNode {
  id: string;
  nodeType: SidNodeType;
  step?: Step;
  /** An expanded sub-decision's entry: its own nodes are traced themselves. */
  expanded?: boolean;
}

/** The one-line caveat shown with every trace and in the export. */
export const TRACE_CAVEAT =
  'Static lineage from the decision\'s metadata, not an execution trace: it does not show which rule fires '
  + 'or what value results, and a write inside a rule happens only when that rule\'s conditions are met.';

/** What mapped nodes mean, shown with the trace and in the export. */
export const MAPPED_CAVEAT =
  'Code files, models, sub-decisions, REST calls and other mapped nodes are shown by their input and output '
  + 'mappings only; they may use a variable internally in ways the app cannot see.';

/** The key a variable is matched by. */
export function variableKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Node kinds whose logic lives outside the flow document. */
const BLACK_BOX_TYPES = new Set<SidNodeType>([
  'decision', 'custom', 'model', 'code_file', 'rest_api',
  'segmentation_tree', 'treatment_group', 'ruleset', 'unknown',
]);

class NameSet {
  private readonly names = new Map<string, string>();
  add(name: string | undefined | null): void {
    if (!name) return;
    const key = variableKey(name);
    if (key && !this.names.has(key)) this.names.set(key, name.trim());
  }
  values(): string[] {
    return [...this.names.values()];
  }
}

function mappingSides(m: StepMapping): { reads: boolean; writes: boolean } {
  const d = (m.direction ?? '').toLowerCase();
  return { reads: d.startsWith('in'), writes: d.includes('out') };
}

/** The decision variable a step term is mapped to (the same name when unmapped). */
function decisionTerm(term: string, mappings: StepMapping[] | undefined): string {
  const key = variableKey(term);
  const m = mappings?.find((x) => variableKey(x.stepTermName ?? '') === key);
  return m?.targetDecisionTermName || term;
}

/** What one node reads and writes, from its structured metadata only. */
export function nodeVariableUsage(node: UsageNode, ruleSetCache: Map<string, RuleSetBundle>): NodeUsage {
  const step = node.step;
  const reads = new NameSet();
  const writes = new NameSet();
  if (!step) return { reads: [], writes: [], source: 'none', opaque: false };

  let logic = false;

  // Branch conditions: the binary branch and a multi-way case (synthetic
  // step). An expression branch has no terms, so it adds nothing.
  if (node.nodeType === 'condition' || node.nodeType === 'cond_expr') {
    reads.add(step.condition?.lhsTerm?.name);
    const rhs = step.condition?.rhsTerm;
    if (rhs && typeof rhs === 'object') reads.add(rhs.name);
    logic = true;
  }

  if (node.nodeType === 'assignment' && step.assignments) {
    for (const a of step.assignments) writes.add(a.variableName);
    logic = true;
  }

  if (node.nodeType === 'record_contact' && step.recordContact) {
    reads.add(step.recordContact.treatmentDatagridTerm ?? undefined);
    reads.add(step.recordContact.channelTerm ?? undefined);
    logic = true;
  }

  if (node.nodeType === 'ruleset' && step.ruleset?.id) {
    const bundle = ruleSetCache.get(step.ruleset.id);
    if (bundle) {
      const view = ruleSetViewOf(bundle);
      for (const t of view.reads) reads.add(decisionTerm(t, step.mappings));
      for (const t of view.writes) writes.add(decisionTerm(t, step.mappings));
      logic = true;
    }
  }

  if (logic) return { reads: reads.values(), writes: writes.values(), source: 'logic', opaque: false };

  if (step.mappings && step.mappings.length > 0) {
    for (const m of step.mappings) {
      const sides = mappingSides(m);
      if (sides.reads) reads.add(m.targetDecisionTermName);
      if (sides.writes) writes.add(m.targetDecisionTermName);
    }
    return { reads: reads.values(), writes: writes.values(), source: 'mapping', opaque: false };
  }

  const opaque = !node.expanded && BLACK_BOX_TYPES.has(node.nodeType);
  return { reads: [], writes: [], source: 'none', opaque };
}

function roleOf(usage: NodeUsage, reads: boolean, writes: boolean): Exclude<TraceRole, 'unknown'> {
  if (usage.source === 'mapping') return reads && writes ? 'mapped-both' : writes ? 'mapped-out' : 'mapped-in';
  return reads && writes ? 'both' : writes ? 'writes' : 'reads';
}

/**
 * The usage index for a set of nodes. `signatures` are the decision's
 * signature first, then its sub-decisions': every signature variable gets an
 * entry, so one nothing uses shows up as such.
 */
export function buildVariableUsageIndex(
  nodes: UsageNode[],
  signatures: SignatureVar[][],
  ruleSetCache: Map<string, RuleSetBundle>,
): VariableUsageIndex {
  const byNode = new Map<string, NodeUsage>();
  const byVariable = new Map<string, VariableUsage>();
  const opaqueNodes: string[] = [];

  const entry = (name: string, direction?: SignatureVar['direction']): VariableUsage => {
    const key = variableKey(name);
    let e = byVariable.get(key);
    if (!e) {
      e = { name: name.trim(), direction, nodes: [] };
      byVariable.set(key, e);
    } else if (direction && !e.direction) {
      e.direction = direction;
    }
    return e;
  };

  // The top-level signature first, so its spelling and direction win.
  for (const sig of signatures) for (const v of sig) entry(v.name, v.direction);

  for (const n of nodes) {
    const usage = nodeVariableUsage(n, ruleSetCache);
    byNode.set(n.id, usage);
    if (usage.opaque) opaqueNodes.push(n.id);
    const readKeys = new Set(usage.reads.map(variableKey));
    const writeKeys = new Set(usage.writes.map(variableKey));
    for (const name of [...usage.writes, ...usage.reads]) {
      const key = variableKey(name);
      const e = entry(name);
      if (e.nodes.some((x) => x.id === n.id)) continue;
      e.nodes.push({ id: n.id, role: roleOf(usage, readKeys.has(key), writeKeys.has(key)) });
    }
  }

  return { byNode, byVariable, opaqueNodes };
}

/** Each node's part in tracing one variable; nodes that take no part are absent. */
export function traceRoles(index: VariableUsageIndex, variable: string): Map<string, TraceRole> {
  const roles = new Map<string, TraceRole>();
  for (const { id, role } of index.byVariable.get(variableKey(variable))?.nodes ?? []) roles.set(id, role);
  for (const id of index.opaqueNodes) if (!roles.has(id)) roles.set(id, 'unknown');
  return roles;
}

/** Short labels for each role, for tags, lists and the export. */
export const TRACE_ROLE_LABELS: Record<TraceRole, string> = {
  reads: 'Reads',
  writes: 'Writes',
  both: 'Reads + writes',
  'mapped-in': 'Mapped in',
  'mapped-out': 'Mapped out',
  'mapped-both': 'Mapped in + out',
  unknown: 'Not checked',
};

/** React Flow nodes as the index reads them. */
export function graphUsageNodes(nodes: Array<{ id: string; data: SidNodeData }>): UsageNode[] {
  return nodes.map((n) => ({
    id: n.id,
    nodeType: n.data.nodeType,
    step: n.data.step,
    expanded: n.data.subDecisionExpanded === true,
  }));
}
