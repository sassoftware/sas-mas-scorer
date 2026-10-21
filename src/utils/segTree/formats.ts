// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Text renderings of a path for the Copy menu and the CSV export. "Merged"
 * folds repeated splits on one variable into a single condition; "raw" lists
 * every split as SID labels it.
 */

import { serializeCsv } from '../csv';
import {
  constraintExpression,
  constraintIsTrivial,
  describeConstraint,
  leafExpectedOutputs,
  NO_OUTCOME,
  pathConstraints,
  pathNumber,
  pathSteps,
  sampleValue,
  type TreeIndex,
} from './treeIndex';

export type PathView = 'merged' | 'raw';

/** The condition lines of a path in the chosen view. */
export function pathLines(index: TreeIndex, branchId: string, view: PathView): string[] {
  if (view === 'raw') {
    return pathSteps(index, branchId).map((s) => `${s.variable}: ${s.label}`);
  }
  return pathConstraints(index, branchId)
    .filter((c) => !constraintIsTrivial(c))
    .map(describeConstraint);
}

function outcomeSuffix(index: TreeIndex, branchId: string): string {
  const branch = index.branches.get(branchId);
  if (!branch || branch.childSplitId) return '';
  if (!branch.outcomeName) return ' → (no outcome)';
  const outputs = leafExpectedOutputs(index, branchId)
    .map((o) => `${o.variable}=${o.value ?? '?'}`)
    .join(', ');
  return ` → ${branch.outcomeName}${outputs ? ` (${outputs})` : ''}`;
}

/** One line, breadcrumb style: `A ≥ 1 › 3 ≤ B < 6 → Scenario_75 (ScenarioID=75)`. */
export function pathAsText(index: TreeIndex, branchId: string, view: PathView): string {
  return pathLines(index, branchId, view).join(' › ') + outcomeSuffix(index, branchId);
}

/** A SAS WHERE / DS2 condition selecting the records that take this path. */
export function pathAsExpression(index: TreeIndex, branchId: string): string {
  const parts = pathConstraints(index, branchId)
    .map((c) => {
      const expr = constraintExpression(c);
      return expr && c.opaque.length ? `${expr} /* also: ${c.opaque.join('; ')} */` : expr;
    })
    .filter((e): e is string => e !== null);
  return parts.length ? parts.join('\n  and ') : '1';
}

export function pathAsMarkdown(index: TreeIndex, branchId: string, view: PathView): string {
  const lines = pathLines(index, branchId, view);
  const branch = index.branches.get(branchId);
  const heading = branch && !branch.childSplitId
    ? `**${index.tree.name}** — Path ${pathNumber(index, branchId)}`
    : `**${index.tree.name}** — partial path`;
  let md = `${heading}\n\n| # | Condition |\n|---|-----------|\n`;
  lines.forEach((l, i) => {
    md += `| ${i + 1} | ${l.replace(/\|/g, '\\|')} |\n`;
  });
  if (branch && !branch.childSplitId) {
    md += `\n**Outcome:** ${branch.outcomeName ?? '(none)'}\n`;
    for (const o of leafExpectedOutputs(index, branchId)) md += `- \`${o.variable}\` = ${o.value ?? '(not a literal)'}\n`;
  }
  return md;
}

/** An input record that takes this path; variables the path does not test are left out. */
export function sampleRecord(index: TreeIndex, branchId: string): Record<string, string | number | null> {
  const record: Record<string, string | number | null> = {};
  for (const c of pathConstraints(index, branchId)) {
    const v = sampleValue(c);
    if (v !== undefined) record[c.variable] = v;
  }
  return record;
}

/** In-app link to a node: the hash route, appended to the page's own base URL. */
export function explorerLink(treeId: string, branchId: string | null): string {
  const base = window.location.href.split('#')[0];
  const query = branchId ? `?at=${encodeURIComponent(branchId)}` : '';
  return `${base}#/segmentation-trees/${encodeURIComponent(treeId)}${query}`;
}

/**
 * Every leaf as one CSV row: path number, one column per tested variable
 * (the merged condition), the outcome and its outputs, and the leaf status.
 * Effectively the strategy table rebuilt from the tree.
 */
export function allPathsCsv(index: TreeIndex): string {
  const variables: string[] = [];
  const perLeaf = index.leafIds.map((id) => {
    const cells = new Map<string, string>();
    for (const c of pathConstraints(index, id)) {
      if (constraintIsTrivial(c)) continue;
      if (!variables.includes(c.variable)) variables.push(c.variable);
      cells.set(c.variable, describeConstraint(c));
    }
    return cells;
  });

  const header = ['Path', ...variables, 'Outcome', ...index.outputVariables, 'Status'];
  const rows = index.leafIds.map((id, i) => {
    const branch = index.branches.get(id)!;
    const outputs = new Map(leafExpectedOutputs(index, id).map((o) => [o.variable, o.value]));
    return [
      String(i + 1),
      ...variables.map((v) => perLeaf[i].get(v) ?? ''),
      branch.outcomeName ?? NO_OUTCOME,
      ...index.outputVariables.map((v) => (outputs.has(v) ? String(outputs.get(v) ?? '') : '')),
      index.leafStatus.get(id) ?? 'ok',
    ];
  });
  return serializeCsv([header, ...rows]);
}
