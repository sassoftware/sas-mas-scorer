// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Generate a Markdown file with decision metadata, Mermaid diagram, and
 * enriched node details (fetched from the server at export time).
 * Sub-decisions are expanded inline — both in the diagram (as subgraphs)
 * and in the markdown (with incremented heading levels).
 */
import type { DecisionFlow, Step, SidNodeType, StepMapping } from '../types/sid';
import { classifyStep, extractSteps, buildConditionExpression, buildBranchCaseExpression } from '../utils/classify';
import { NODE_TYPE_LABELS, CODE_TYPE_LABELS } from './constants';
import { buildDeepLink, buildDecisionDeepLink, buildRuleSetDeepLink, buildModelDeepLink, buildCustomObjectDeepLink } from '../utils/deepLinks';
import { getRuleSet, getRuleSetRules, type RuleSetDetail, type BusinessRule } from '../api/rulesets';
import { getSidModel, type SidModelDetail } from '../api/sidModels';
import { getCodeFileDetail, getFileContent, stripLeadingJsonComment, type CodeFileDetail } from '../api/codeFiles';
import { getTreatmentGroupByUri, getTreatmentDefinitionByRevision, type TreatmentGroupDetail, type TreatmentDefinitionDetail } from '../api/treatments';
import { getDecisionNodeType, type DecisionNodeTypeDetail } from '../api/nodeTypes';
import { getSegmentationTree, type SegmentationTreeDetail } from '../api/segmentationTrees';
import { getDecisionRevision } from '../api/decisions';

/* ================================================================== */
/*  Mermaid diagram generation (with subgraph support)                 */
/* ================================================================== */

function safeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[[\](){}]/g, ' ')
    .trim();
}

const MERMAID_SHAPES: Record<SidNodeType, string> = {
  start: '(["{label}"])',
  end: '(["{label}"])',
  decision: '(["{label}"])',
  custom: '>"{label}"]',
  ruleset: '[/"{label}"\\]',
  model: '[("{label}")]',
  code_file: '[["{label}"]]',
  condition: '{{"{label}"}}',
  cond_expr: '{{"{label}"}}',
  assignment: '["{label}"]',
  abtest: '{{"{label}"}}',
  parallel: '[["{label}"]]',
  record_contact: '[("{label}")]',
  treatment_group: '[/"{label}"\\]',
  segmentation_tree: '[("{label}")]',
  unknown: '["{label}"]',
};

const MERMAID_CLASSES: Record<SidNodeType, string> = {
  start: 'startNode',
  end: 'endNode',
  decision: 'decisionNode',
  custom: 'customNode',
  ruleset: 'rulesetNode',
  model: 'modelNode',
  code_file: 'codeNode',
  condition: 'conditionNode',
  cond_expr: 'conditionNode',
  assignment: 'assignmentNode',
  abtest: 'abtestNode',
  parallel: 'parallelNode',
  record_contact: 'recordContactNode',
  treatment_group: 'treatmentGroupNode',
  segmentation_tree: 'segTreeNode',
  unknown: 'unknownNode',
};

interface MermaidState {
  lines: string[];
  idCounter: number;
  linkTargets: Map<string, string>;
  linkLabels: Map<string, string>;
  subDecisionCache: Map<string, DecisionFlow>;
  depth: number;
  maxDepth: number;
  indent: string;
}

interface Pending { id: string; label: string }

function nextMid(state: MermaidState): string {
  return `n${state.idCounter++}`;
}

function addMNode(state: MermaidState, mid: string, nodeType: SidNodeType, label: string): void {
  const shape = MERMAID_SHAPES[nodeType].replace('{label}', safeLabel(label));
  state.lines.push(`${state.indent}${mid}${shape}`);
  state.lines.push(`${state.indent}class ${mid} ${MERMAID_CLASSES[nodeType]}`);
}

function addMEdge(state: MermaidState, from: string, to: string, label: string, dotted = false): void {
  const arrow = dotted ? '-.->': '-->';
  if (label) {
    state.lines.push(`${state.indent}${from} ${arrow}|${safeLabel(label)}| ${to}`);
  } else {
    state.lines.push(`${state.indent}${from} ${arrow} ${to}`);
  }
}

function processStepsMermaid(
  state: MermaidState,
  steps: Step[],
  pending: Pending[],
): { firstId: string | null; terminals: Pending[] } {
  let firstId: string | null = null;
  let current = [...pending];

  for (const step of steps) {
    const { nodeType, label } = classifyStep(step);

    if (step.decisionNodeLinkTarget) {
      const target = step.decisionNodeLinkTarget;
      const uuid = typeof target === 'string' ? target : target?.nodeId;
      if (uuid) {
        for (const p of current) {
          state.linkTargets.set(`${p.id}|${p.label}`, uuid);
        }
        current = [];
      }
      continue;
    }

    if (step.abTestCases && step.abTestCases.length > 0) {
      const abtestMid = nextMid(state);
      addMNode(state, abtestMid, 'abtest', step.name ?? 'A/B Test');
      for (const p of current) addMEdge(state, p.id, abtestMid, p.label);
      if (!firstId) firstId = abtestMid;

      const branchTerminals: Pending[] = [];
      for (const tc of step.abTestCases) {
        const caseLabel = tc.label
          ? `${tc.label}${tc.percent != null ? ` (${tc.percent}%)` : ''}`
          : `${tc.percent ?? '?'}%`;
        const trueSteps = extractSteps(tc.onTrue);
        if (trueSteps.length > 0) {
          const r = processStepsMermaid(state, trueSteps, [{ id: abtestMid, label: caseLabel }]);
          branchTerminals.push(...r.terminals);
        } else {
          branchTerminals.push({ id: abtestMid, label: caseLabel });
        }
      }
      current = branchTerminals;
      continue;
    }

    if (step.type === 'application/vnd.sas.decision.step.parallel' && step.nodes && step.nodes.length > 0) {
      const parallelMid = nextMid(state);
      addMNode(state, parallelMid, 'parallel', step.name ?? 'Parallel Process');
      for (const p of current) addMEdge(state, p.id, parallelMid, p.label);
      if (!firstId) firstId = parallelMid;

      const parallelTerminals: Pending[] = [];
      for (const pn of step.nodes) {
        const pnMid = nextMid(state);
        addMNode(state, pnMid, 'decision', pn.name);
        addMEdge(state, parallelMid, pnMid, '');
        parallelTerminals.push({ id: pnMid, label: '' });
      }
      current = parallelTerminals;
      continue;
    }

    if (step.branchCases && step.branchCases.length > 0) {
      const branchTerminals: Pending[] = [];
      let currentPending = [...current];

      for (const bc of step.branchCases) {
        const caseExpr = buildBranchCaseExpression(bc);
        const caseMid = nextMid(state);
        addMNode(state, caseMid, 'condition', caseExpr);
        for (const p of currentPending) addMEdge(state, p.id, caseMid, p.label);
        if (!firstId) firstId = caseMid;

        const trueSteps = extractSteps(bc.onTrue);
        if (trueSteps.length > 0) {
          const r = processStepsMermaid(state, trueSteps, [{ id: caseMid, label: 'Yes' }]);
          branchTerminals.push(...r.terminals);
        } else {
          branchTerminals.push({ id: caseMid, label: 'Yes' });
        }

        currentPending = [{ id: caseMid, label: 'No' }];
      }

      const defaultSteps = extractSteps(step.defaultCase);
      if (defaultSteps.length > 0) {
        const r = processStepsMermaid(state, defaultSteps, currentPending);
        branchTerminals.push(...r.terminals);
      } else {
        branchTerminals.push(...currentPending);
      }

      current = branchTerminals;
      continue;
    }

    if (nodeType === 'condition' || nodeType === 'cond_expr') {
      const mid = nextMid(state);
      addMNode(state, mid, nodeType, label);
      if (step.linkLabel) state.linkLabels.set(step.linkLabel, mid);
      for (const p of current) addMEdge(state, p.id, mid, p.label);
      if (!firstId) firstId = mid;

      const branchTerminals: Pending[] = [];
      const trueSteps = extractSteps(step.onTrue);
      if (trueSteps.length > 0) {
        const r = processStepsMermaid(state, trueSteps, [{ id: mid, label: 'Yes' }]);
        branchTerminals.push(...r.terminals);
      } else {
        branchTerminals.push({ id: mid, label: 'Yes' });
      }

      const falseSteps = extractSteps(step.onFalse);
      if (falseSteps.length > 0) {
        const r = processStepsMermaid(state, falseSteps, [{ id: mid, label: 'No' }]);
        branchTerminals.push(...r.terminals);
      } else {
        branchTerminals.push({ id: mid, label: 'No' });
      }

      current = branchTerminals;
      continue;
    }

    if (step.steps && step.steps.length > 0) {
      const r = processStepsMermaid(state, step.steps, current);
      if (r.firstId) {
        if (!firstId) firstId = r.firstId;
        current = r.terminals;
      }
      continue;
    }

    if (
      step.customObject?.type === 'decision' &&
      state.depth < state.maxDepth &&
      state.subDecisionCache.has(step.customObject.uri)
    ) {
      const subFlow = state.subDecisionCache.get(step.customObject.uri)!;
      const subSteps = subFlow.flow?.steps ?? [];

      if (subSteps.length > 0) {
        const subgraphId = `sub_${nextMid(state)}`;
        state.lines.push(`${state.indent}subgraph ${subgraphId}["${safeLabel(step.customObject.name)}"]`);

        const prevIndent = state.indent;
        state.indent = prevIndent + '    ';
        state.depth++;

        const subStartId = nextMid(state);
        addMNode(state, subStartId, 'start', step.customObject.name);

        const result = processStepsMermaid(state, subSteps, [{ id: subStartId, label: '' }]);

        state.depth--;
        state.indent = prevIndent;
        state.lines.push(`${state.indent}end`);
        state.lines.push(`${state.indent}style ${subgraphId} fill:#FDEAEB22,stroke:#E06050,stroke-width:2px,stroke-dasharray:6 3`);

        for (const p of current) addMEdge(state, p.id, subStartId, p.label);
        if (!firstId) firstId = subStartId;
        current = result.terminals;
        continue;
      }
    }

    const mid = nextMid(state);
    addMNode(state, mid, nodeType, label);
    if (step.linkLabel) state.linkLabels.set(step.linkLabel, mid);
    for (const p of current) addMEdge(state, p.id, mid, p.label);
    if (!firstId) firstId = mid;
    current = [{ id: mid, label: '' }];
  }

  return { firstId, terminals: current };
}

export function generateMermaid(
  flow: DecisionFlow,
  subDecisionCache: Map<string, DecisionFlow> = new Map(),
): string {
  const name = flow.name ?? 'Decision Flow';
  const steps = flow.flow?.steps ?? [];

  const state: MermaidState = {
    lines: [],
    idCounter: 0,
    linkTargets: new Map(),
    linkLabels: new Map(),
    subDecisionCache,
    depth: 0,
    maxDepth: 3,
    indent: '    ',
  };

  state.lines.push('---');
  state.lines.push(`title: ${safeLabel(name)}`);
  state.lines.push('---');
  state.lines.push('flowchart TD');

  const startMid = nextMid(state);
  addMNode(state, startMid, 'start', 'Start');

  const { terminals } = processStepsMermaid(state, steps, [{ id: startMid, label: '' }]);

  const endMid = nextMid(state);
  addMNode(state, endMid, 'end', 'End');
  for (const t of terminals) addMEdge(state, t.id, endMid, t.label);

  for (const [key, uuid] of state.linkTargets) {
    const [src, lbl] = key.split('|');
    const tgt = state.linkLabels.get(uuid) ?? endMid;
    addMEdge(state, src, tgt, lbl, true);
  }

  state.lines.push('');
  state.lines.push('    %% Styles');
  state.lines.push('    classDef startNode fill:#fff,stroke:#999,color:#333,stroke-width:1px');
  state.lines.push('    classDef endNode fill:#fff,stroke:#999,color:#333,stroke-width:1px');
  state.lines.push('    classDef decisionNode fill:#FDEAEB,stroke:#E06050,color:#333,stroke-width:2px');
  state.lines.push('    classDef customNode fill:#E0F2F1,stroke:#26A69A,color:#333,stroke-width:2px');
  state.lines.push('    classDef rulesetNode fill:#DDEAF6,stroke:#5B9BD5,color:#333,stroke-width:2px');
  state.lines.push('    classDef modelNode fill:#E8DEF3,stroke:#7B68AE,color:#333,stroke-width:2px');
  state.lines.push('    classDef codeNode fill:#DDEAF6,stroke:#5B9BD5,color:#333,stroke-width:2px');
  state.lines.push('    classDef conditionNode fill:#FEF4D5,stroke:#F4B942,color:#333,stroke-width:2px');
  state.lines.push('    classDef assignmentNode fill:#E8F5E9,stroke:#66BB6A,color:#333,stroke-width:2px');
  state.lines.push('    classDef abtestNode fill:#FFF3E0,stroke:#FF9800,color:#333,stroke-width:2px');
  state.lines.push('    classDef parallelNode fill:#E3F2FD,stroke:#42A5F5,color:#333,stroke-width:2px');
  state.lines.push('    classDef recordContactNode fill:#FCE4EC,stroke:#EC407A,color:#333,stroke-width:2px');
  state.lines.push('    classDef treatmentGroupNode fill:#F3E5F5,stroke:#AB47BC,color:#333,stroke-width:2px');
  state.lines.push('    classDef segTreeNode fill:#E0F2F1,stroke:#009688,color:#333,stroke-width:2px');
  state.lines.push('    classDef unknownNode fill:#F0F0F0,stroke:#999,color:#333');

  return state.lines.join('\n');
}

/* ================================================================== */
/*  Node detail collection (with sub-decision recursion)               */
/* ================================================================== */

interface NodeInfo {
  name: string;
  type: SidNodeType;
  typeLabel: string;
  step: Step;
  expression?: string;
  anchor: string;
  depth: number;
  subDecisionName?: string;
  isSubDecisionStart?: boolean;
  isSubDecisionEnd?: boolean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 40);
}

function collectNodes(
  steps: Step[],
  subDecisionCache: Map<string, DecisionFlow>,
  depth: number,
  result: NodeInfo[] = [],
): NodeInfo[] {
  for (const step of steps) {
    const { nodeType, label } = classifyStep(step);

    if (step.decisionNodeLinkTarget) continue;

    if (step.abTestCases && step.abTestCases.length > 0) {
      const idx = result.length + 1;
      result.push({
        name: step.name ?? 'A/B Test',
        type: 'abtest',
        typeLabel: NODE_TYPE_LABELS['abtest'],
        step,
        anchor: `node-${idx}-${slugify(step.name ?? 'abtest')}`,
        depth,
      });
      for (const tc of step.abTestCases) {
        const trueSteps = extractSteps(tc.onTrue);
        if (trueSteps.length > 0) collectNodes(trueSteps, subDecisionCache, depth, result);
      }
      continue;
    }

    if (step.branchCases && step.branchCases.length > 0) {
      for (const bc of step.branchCases) {
        const caseExpr = buildBranchCaseExpression(bc);
        const caseLabel = bc.label ?? caseExpr;
        const idx = result.length + 1;
        result.push({
          name: caseLabel,
          type: 'condition',
          typeLabel: NODE_TYPE_LABELS['condition'],
          step: { ...step, id: bc.id, name: caseLabel, condition: bc.simpleCondition ?? undefined, branchCases: undefined, defaultCase: undefined },
          expression: caseExpr,
          anchor: `node-${idx}-${slugify(caseLabel)}`,
          depth,
        });
        const trueSteps = extractSteps(bc.onTrue);
        if (trueSteps.length > 0) collectNodes(trueSteps, subDecisionCache, depth, result);
      }
      const defaultSteps = extractSteps(step.defaultCase);
      if (defaultSteps.length > 0) collectNodes(defaultSteps, subDecisionCache, depth, result);
      continue;
    }

    if (
      step.customObject?.type === 'decision' &&
      depth < 3 &&
      subDecisionCache.has(step.customObject.uri)
    ) {
      const subFlow = subDecisionCache.get(step.customObject.uri)!;
      const subSteps = subFlow.flow?.steps ?? [];

      const idx = result.length + 1;
      const subAnchor = `sub-${idx}-${slugify(step.customObject.name)}`;
      result.push({
        name: step.customObject.name,
        type: 'decision',
        typeLabel: 'Sub-Decision',
        step,
        anchor: subAnchor,
        depth,
        subDecisionName: step.customObject.name,
        isSubDecisionStart: true,
      });

      if (subSteps.length > 0) {
        collectNodes(subSteps, subDecisionCache, depth + 1, result);
      }

      result.push({
        name: step.customObject.name,
        type: 'decision',
        typeLabel: 'Sub-Decision',
        step,
        anchor: `${subAnchor}-end`,
        depth,
        isSubDecisionEnd: true,
      });
      continue;
    }

    if (nodeType !== 'unknown' || step.name) {
      const idx = result.length + 1;
      result.push({
        name: label,
        type: nodeType,
        typeLabel: NODE_TYPE_LABELS[nodeType] ?? nodeType,
        step,
        expression: (nodeType === 'condition' || nodeType === 'cond_expr')
          ? buildConditionExpression(step) : undefined,
        anchor: `node-${idx}-${slugify(label)}`,
        depth,
      });
    }

    if (step.onTrue) collectNodes(extractSteps(step.onTrue), subDecisionCache, depth, result);
    if (step.onFalse) collectNodes(extractSteps(step.onFalse), subDecisionCache, depth, result);
    if (step.steps) collectNodes(step.steps, subDecisionCache, depth, result);
  }
  return result;
}

function extractIdFromUri(uri: string): string | null {
  const matches = uri.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return matches ? matches[0] : null;
}

/* ================================================================== */
/*  Fetched detail types                                               */
/* ================================================================== */

interface FetchedNodeDetails {
  ruleSet?: RuleSetDetail;
  rules?: BusinessRule[];
  model?: SidModelDetail;
  codeFile?: CodeFileDetail;
  codeContent?: string;
  nodeType?: DecisionNodeTypeDetail;
  treatmentGroup?: TreatmentGroupDetail;
  treatmentDefs?: TreatmentDefinitionDetail[];
  treatmentEligibilityRuleSets?: Map<string, RuleSetDetail>;
  segmentationTree?: SegmentationTreeDetail;
  subDecisionFlow?: DecisionFlow;
}

async function fetchNodeDetails(step: Step, subDecisionCache: Map<string, DecisionFlow>): Promise<FetchedNodeDetails> {
  const details: FetchedNodeDetails = {};

  if (step.ruleset?.id) {
    const [rs, rules] = await Promise.allSettled([
      getRuleSet(step.ruleset.id),
      getRuleSetRules(step.ruleset.id),
    ]);
    if (rs.status === 'fulfilled') details.ruleSet = rs.value;
    if (rules.status === 'fulfilled') details.rules = rules.value;
  }

  if (step.model?.id) {
    try { details.model = await getSidModel(step.model.id); } catch { /* skip */ }
  }

  const customObjType = step.customObject?.type ?? '';
  const codeFileUri = CODE_TYPE_LABELS[customObjType] && step.customObject?.uri
    ? step.customObject.uri : null;
  if (codeFileUri) {
    try {
      const cf = await getCodeFileDetail(codeFileUri);
      details.codeFile = cf;
      const fileContentLink = cf.links?.find(
        (l) => l.rel === 'content' || (l.href ?? l.uri ?? '').includes('/files/files/'),
      );
      const contentPath = fileContentLink ? (fileContentLink.href ?? fileContentLink.uri) : cf.fileUri;
      if (contentPath) {
        try {
          const raw = await getFileContent(contentPath);
          const { code } = stripLeadingJsonComment(raw);
          details.codeContent = code;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const ntLink = step.links?.find(
    (l) => l.rel === 'decisionNodeType' || (l.href ?? l.uri ?? '').includes('/decisions/decisionNodeTypes/'),
  );
  if (ntLink) {
    const ntId = extractIdFromUri(ntLink.href ?? ntLink.uri);
    if (ntId) {
      try { details.nodeType = await getDecisionNodeType(ntId); } catch { /* skip */ }
    }
  }

  if (step.customObject?.type === 'treatmentGroup' && step.customObject?.uri) {
    try {
      const group = await getTreatmentGroupByUri(step.customObject.uri);
      details.treatmentGroup = group;
      if (group.members && group.members.length > 0) {
        const defResults = await Promise.allSettled(
          group.members
            .filter((m) => m.definitionId && m.definitionRevisionId)
            .map((m) => getTreatmentDefinitionByRevision(m.definitionId, m.definitionRevisionId!)),
        );
        details.treatmentDefs = defResults
          .filter((r): r is PromiseFulfilledResult<TreatmentDefinitionDetail> => r.status === 'fulfilled')
          .map((r) => r.value);

        const rsMap = new Map<string, RuleSetDetail>();
        await Promise.allSettled(
          (details.treatmentDefs ?? [])
            .filter((d) => d.eligibility?.ruleSetUri)
            .map(async (d) => {
              const rsId = extractIdFromUri(d.eligibility!.ruleSetUri!);
              if (rsId) {
                const rs = await getRuleSet(rsId);
                rsMap.set(d.id, rs);
              }
            }),
        );
        details.treatmentEligibilityRuleSets = rsMap;
      }
    } catch { /* skip */ }
  }

  if (step.customObject?.type === 'segmentationTree' && step.customObject?.uri) {
    try { details.segmentationTree = await getSegmentationTree(step.customObject.uri); } catch { /* skip */ }
  }

  if (step.customObject?.type === 'decision' && step.customObject?.uri) {
    details.subDecisionFlow = subDecisionCache.get(step.customObject.uri);
  }

  return details;
}

/* ================================================================== */
/*  Markdown formatting helpers                                        */
/* ================================================================== */

function formatMappings(mappings: StepMapping[]): string {
  let md = '| Step Term | Direction | Decision Variable |\n';
  md += '|-----------|-----------|--------------------|\n';
  for (const m of mappings) {
    md += `| \`${m.stepTermName}\` | ${m.direction} | \`${m.targetDecisionTermName}\` |\n`;
  }
  return md;
}

function deepLinkMd(info: { url: string; label: string } | null): string {
  if (!info) return '';
  return `> [${info.label}](${info.url})\n\n`;
}

function heading(depth: number, base: number = 3): string {
  return '#'.repeat(Math.min(base + depth, 6));
}

function formatNodeSection(node: NodeInfo, index: number, details: FetchedNodeDetails): string {
  const { step, depth } = node;
  const h = heading(depth);
  const hSub = heading(depth, 4);

  if (node.isSubDecisionStart) {
    let md = `${h} ${index + 1}. Sub-Decision: ${node.name}\n\n`;
    md += deepLinkMd(buildDeepLink('decision', step.customObject!.uri));
    md += `- **Type**: Sub-Decision\n`;
    md += `- **URI**: \`${step.customObject!.uri}\`\n`;
    if (details.subDecisionFlow) {
      const sf = details.subDecisionFlow;
      if (sf.description) md += `- **Description**: ${sf.description}\n`;
      md += `- **Version**: ${sf.majorRevision}.${sf.minorRevision}\n`;
      md += `- **Created by**: ${sf.createdBy}\n`;
      md += `- **Modified**: ${sf.modifiedTimeStamp}\n`;
      if (sf.validationStatus) md += `- **Validation**: ${sf.validationStatus}\n`;

      const subSig = sf.signature ?? [];
      if (subSig.length > 0) {
        md += `\n**Variables** (${subSig.length}):\n\n`;
        md += '| Name | Type | Direction | Description |\n|------|------|-----------|-------------|\n';
        for (const v of subSig) {
          md += `| \`${v.name}\` | ${v.dataType} | ${v.direction} | ${v.description ?? ''} |\n`;
        }
        md += '\n';
      }
    }
    if (step.mappings && step.mappings.length > 0) {
      md += `\n**Mappings** (${step.mappings.length}):\n\n`;
      md += formatMappings(step.mappings);
      md += '\n';
    }
    md += '\nThe following nodes are inside this sub-decision:\n\n';
    md += '---\n\n';
    return md;
  }

  if (node.isSubDecisionEnd) {
    return `*End of sub-decision: ${node.name}*\n\n---\n\n`;
  }

  let md = `${h} ${index + 1}. ${node.name}\n\n`;
  md += `- **Type**: ${node.typeLabel}\n`;

  if (details.nodeType?.description) {
    md += `- **Description**: ${details.nodeType.description}\n`;
  }

  if (node.expression) {
    md += `- **Expression**: \`${node.expression}\`\n`;
  }

  md += '\n';

  if (step.assignments && step.assignments.length > 0) {
    md += '**Assignments**:\n\n';
    md += '| Variable | Type | Value |\n|----------|------|-------|\n';
    for (const a of step.assignments) {
      md += `| \`${a.variableName}\` | ${a.dataType ?? '\u2014'} | \`${a.value ?? '\u2014'}\` |\n`;
    }
    md += '\n';
  }

  if (step.abTestCases && step.abTestCases.length > 0) {
    if (step.abTestType) md += `- **Test Type**: ${step.abTestType}\n`;
    md += '\n**Test Cases**:\n\n';
    md += '| Label | Role | Percent |\n|-------|------|---------|\n';
    for (const tc of step.abTestCases) {
      md += `| ${tc.label ?? '\u2014'} | ${tc.role ?? '\u2014'} | ${tc.percent != null ? `${tc.percent}%` : '\u2014'} |\n`;
    }
    md += '\n';
  }

  if (step.type === 'application/vnd.sas.decision.step.parallel' && step.nodes && step.nodes.length > 0) {
    md += '**Parallel Nodes**:\n\n';
    for (const pn of step.nodes) {
      md += `- **${pn.name}**${pn.uri ? ` \u2014 \`${pn.uri}\`` : ''}\n`;
    }
    md += '\n';
  }

  if (step.recordContact) {
    const rc = step.recordContact;
    if (rc.name) md += `- **Contact Name**: ${rc.name}\n`;
    md += `- **Rule Fired Tracking**: ${rc.ruleFiredTracking ? 'Yes' : 'No'}\n`;
    md += `- **Path Tracking**: ${rc.pathTracking ? 'Yes' : 'No'}\n`;
    if (rc.responseTrackingVariableName) md += `- **Response Tracking Variable**: \`${rc.responseTrackingVariableName}\`\n`;
    md += `- **Exclude from Contact Aggregation**: ${rc.excludeFromContactAggregation ? 'Yes' : 'No'}\n`;
    md += '\n';
  }

  if (details.segmentationTree) {
    const st = details.segmentationTree;
    if (st.description) md += `- **Description**: ${st.description}\n`;
    if (st.majorRevision != null) md += `- **Version**: ${st.majorRevision}.${st.minorRevision ?? 0}\n`;

    if (st.signature && st.signature.length > 0) {
      md += `\n**Signature** (${st.signature.length}):\n\n`;
      md += '| Name | Type | Direction |\n|------|------|-----------|\n';
      for (const v of st.signature) {
        md += `| \`${v.name}\` | ${v.dataType} | ${v.direction} |\n`;
      }
      md += '\n';
    }

    if (st.booleanExpressions && st.booleanExpressions.length > 0) {
      md += `**Split Conditions** (${st.booleanExpressions.length}):\n\n`;
      for (const be of st.booleanExpressions) {
        md += `- **${be.name}**: \`${be.expression}\`\n`;
      }
      md += '\n';
    }

    if (st.outcomes && st.outcomes.length > 0) {
      md += `**Outcomes** (${st.outcomes.length}):\n\n`;
      for (const oc of st.outcomes) {
        md += `- **${oc.name}**`;
        if (oc.actions && oc.actions.length > 0) {
          md += `: ${oc.actions.map((a) => `\`${a.variableName} = ${a.value}\``).join(', ')}`;
        }
        md += '\n';
      }
      md += '\n';
    }
  }

  if (step.customObject?.type === 'decision' && !node.isSubDecisionStart) {
    md += deepLinkMd(buildDeepLink('decision', step.customObject.uri));
    md += `- **Sub-Decision URI**: \`${step.customObject.uri}\`\n`;
    if (details.subDecisionFlow) {
      const sf = details.subDecisionFlow;
      if (sf.description) md += `- **Description**: ${sf.description}\n`;
      md += `- **Version**: ${sf.majorRevision}.${sf.minorRevision}\n`;
    }
    md += '\n';
  }

  if (step.customObject?.type && CODE_TYPE_LABELS[step.customObject.type]) {
    md += deepLinkMd(buildCustomObjectDeepLink(step.customObject.type, step.customObject.uri));
    md += `- **Language**: ${CODE_TYPE_LABELS[step.customObject.type]}\n`;
    if (details.codeFile) {
      const cf = details.codeFile;
      if (cf.name) md += `- **Name**: ${cf.name}\n`;
      if (cf.description) md += `- **Description**: ${cf.description}\n`;
      if (cf.status) md += `- **Status**: ${cf.status}\n`;
      if (cf.majorRevision != null) md += `- **Version**: ${cf.majorRevision}.${cf.minorRevision ?? 0}\n`;
      if (cf.signature && cf.signature.length > 0) {
        md += `\n**Signature** (${cf.signature.length}):\n\n`;
        md += '| Name | Type | Direction | Length |\n|------|------|-----------|--------|\n';
        for (const t of cf.signature) {
          md += `| \`${t.name}\` | ${t.dataType} | ${t.direction} | ${t.length ?? '\u2014'} |\n`;
        }
        md += '\n';
      }
    }
    if (details.codeContent) {
      const lang = CODE_TYPE_LABELS[step.customObject.type]?.toLowerCase() ?? '';
      const langHint = lang === 'ds2' ? 'sas' : lang === 'query' ? 'sql' : lang;
      md += `\n<details>\n<summary>Source Code</summary>\n\n\`\`\`${langHint}\n${details.codeContent}\n\`\`\`\n</details>\n\n`;
    }
  }

  if (step.ruleset) {
    md += deepLinkMd(buildRuleSetDeepLink(step.ruleset.id));
    md += `- **Rule Set**: ${step.ruleset.name}`;
    if (step.ruleset.versionName) md += ` (v${step.ruleset.versionName})`;
    md += `\n- **Rule Set ID**: \`${step.ruleset.id}\`\n`;
    if (details.ruleSet) {
      const rs = details.ruleSet;
      if (rs.description) md += `- **Description**: ${rs.description}\n`;
      if (rs.ruleSetType) md += `- **Type**: ${rs.ruleSetType}\n`;
      if (rs.status) md += `- **Status**: ${rs.status}\n`;
      if (rs.majorRevision != null) md += `- **Full Version**: ${rs.majorRevision}.${rs.minorRevision ?? 0}\n`;
      if (rs.signature && rs.signature.length > 0) {
        md += `\n**Signature** (${rs.signature.length}):\n\n`;
        md += '| Name | Type | Direction | Length |\n|------|------|-----------|--------|\n';
        for (const t of rs.signature) {
          md += `| \`${t.name}\` | ${t.dataType} | ${t.direction} | ${t.length ?? '\u2014'} |\n`;
        }
        md += '\n';
      }
    }
    const rules = details.rules ?? details.ruleSet?.rules;
    if (rules && rules.length > 0) {
      md += `\n**Rules** (${rules.length}):\n\n`;
      for (const rule of rules) {
        md += `- **${rule.name}**`;
        if (rule.conditional) md += ` *(${rule.conditional.toUpperCase()})*`;
        md += '\n';
        if (rule.conditions && rule.conditions.length > 0) {
          for (const c of rule.conditions) {
            const expr = c.type === 'complex' && c.expression
              ? c.expression
              : c.term ? `${c.term.name} ${c.expression ?? ''}` : c.expression ?? '';
            if (expr) md += `  - Condition: \`${expr}\`\n`;
          }
        }
        if (rule.actions && rule.actions.length > 0) {
          for (const a of rule.actions) {
            const expr = a.term ? `${a.term.name} = ${a.expression}` : a.expression ?? '';
            if (expr) md += `  - Action: \`${expr}\`\n`;
          }
        }
      }
      md += '\n';
    }
  }

  if (step.model) {
    md += deepLinkMd(buildModelDeepLink(step.model.id));
    md += `- **Model**: ${step.model.name}`;
    if (step.model.algorithmName) md += ` (${step.model.algorithmName})`;
    md += `\n- **Model ID**: \`${step.model.id}\`\n`;
    if (step.model.versionName) md += `- **Version**: ${step.model.versionName}\n`;
    if (details.model) {
      const m = details.model;
      if (m.description) md += `- **Description**: ${m.description}\n`;
      if (m.algorithm || m.algorithmName) md += `- **Algorithm**: ${m.algorithm ?? m.algorithmName}\n`;
      if (m.function) md += `- **Function**: ${m.function}\n`;
      if (m.tool) md += `- **Tool**: ${m.tool}${m.toolVersion ? ` ${m.toolVersion}` : ''}\n`;
      if (m.modeler) md += `- **Modeler**: ${m.modeler}\n`;
      if (m.role) md += `- **Role**: ${m.role}\n`;
      if (m.targetVariable) md += `- **Target**: ${m.targetVariable}${m.targetEvent ? ` (event: ${m.targetEvent})` : ''}\n`;
      if (m.targetLevel) md += `- **Target Level**: ${m.targetLevel}\n`;
      if (m.scoreCodeType) md += `- **Score Code**: ${m.scoreCodeType}\n`;
      if (m.trainTable) md += `- **Training Table**: ${m.trainTable}\n`;
      if (m.projectName) {
        md += `- **Project**: ${m.projectName}`;
        if (m.projectVersionName) md += ` (${m.projectVersionName})`;
        md += '\n';
      }
      if (m.inputVariables && m.inputVariables.length > 0) {
        md += `\n**Input Variables** (${m.inputVariables.length}):\n\n`;
        md += '| Name | Role | Type | Level | Length |\n|------|------|------|-------|--------|\n';
        for (const v of m.inputVariables) {
          md += `| \`${v.name}\` | ${v.role ?? '\u2014'} | ${v.type ?? '\u2014'} | ${v.level ?? '\u2014'} | ${v.length ?? '\u2014'} |\n`;
        }
        md += '\n';
      }
      if (m.outputVariables && m.outputVariables.length > 0) {
        md += `\n**Output Variables** (${m.outputVariables.length}):\n\n`;
        md += '| Name | Role | Type | Level | Length |\n|------|------|------|-------|--------|\n';
        for (const v of m.outputVariables) {
          md += `| \`${v.name}\` | ${v.role ?? '\u2014'} | ${v.type ?? '\u2014'} | ${v.level ?? '\u2014'} | ${v.length ?? '\u2014'} |\n`;
        }
        md += '\n';
      }
      if (m.properties && m.properties.length > 0) {
        md += `\n**Properties** (${m.properties.length}):\n\n`;
        md += '| Name | Value |\n|------|-------|\n';
        for (const p of m.properties) {
          md += `| ${p.name} | ${p.value} |\n`;
        }
        md += '\n';
      }
    }
  }

  if (step.customObject?.type === 'treatmentGroup') {
    md += deepLinkMd(buildDeepLink('treatmentGroup', step.customObject.uri));
    if (details.treatmentGroup) {
      const g = details.treatmentGroup;
      md += `- **Name**: ${g.name}\n`;
      if (g.description) md += `- **Description**: ${g.description}\n`;
      if (g.activationStatus) md += `- **Status**: ${g.activationStatus}\n`;
      if (g.majorRevision != null) md += `- **Version**: ${g.majorRevision}.${g.minorRevision ?? 0}\n`;
      md += '\n';

      if (details.treatmentDefs && details.treatmentDefs.length > 0) {
        md += `**Treatments** (${details.treatmentDefs.length}):\n\n`;
        for (const def of details.treatmentDefs) {
          md += `${hSub} ${def.name}\n\n`;
          if (def.description) md += `${def.description}\n\n`;
          if (def.majorRevision != null) md += `- **Version**: ${def.majorRevision}.${def.minorRevision ?? 0}\n`;
          if (def.status) md += `- **Status**: ${def.status}\n`;

          if (def.attributes && def.attributes.length > 0) {
            md += `\n**Attributes** (${def.attributes.length}):\n\n`;
            md += '| Name | Type | Default |\n|------|------|---------|\n';
            for (const a of def.attributes) {
              md += `| \`${a.name}\` | ${a.valueConstraints?.dataType ?? '\u2014'} | ${a.defaultValue != null ? String(a.defaultValue) : '\u2014'} |\n`;
            }
            md += '\n';
          }

          if (def.eligibility) {
            md += '**Eligibility**:\n\n';
            if (def.eligibility.startDate) md += `- **Start**: ${def.eligibility.startDate}\n`;
            if (def.eligibility.endDate) md += `- **End**: ${def.eligibility.endDate}\n`;
            if (def.eligibility.ruleSetUri) {
              const eligRS = details.treatmentEligibilityRuleSets?.get(def.id);
              if (eligRS) {
                const rsDeepLink = buildRuleSetDeepLink(eligRS.id);
                if (rsDeepLink) md += `> [${rsDeepLink.label}](${rsDeepLink.url})\n\n`;
                md += `- **Rule Set**: ${eligRS.name}`;
                if (eligRS.majorRevision != null) md += ` (v${eligRS.majorRevision}.${eligRS.minorRevision ?? 0})`;
                md += '\n';
                if (eligRS.description) md += `- **Rule Set Description**: ${eligRS.description}\n`;
              } else {
                md += `- **Rule Set URI**: \`${def.eligibility.ruleSetUri}\`\n`;
                if (def.eligibility.ruleSetName) md += `- **Rule Set Name**: ${def.eligibility.ruleSetName}\n`;
              }
            }
            md += '\n';
          }
        }
      }
    } else {
      md += `- **URI**: \`${step.customObject.uri}\`\n`;
    }
  }

  if (step.customObject
    && step.customObject.type !== 'decision'
    && step.customObject.type !== 'treatmentGroup'
    && !CODE_TYPE_LABELS[step.customObject.type]) {
    const dl = buildCustomObjectDeepLink(step.customObject.type, step.customObject.uri);
    md += deepLinkMd(dl);
    md += `- **Custom Object**: ${step.customObject.name} (type: \`${step.customObject.type}\`)\n`;
    md += `- **URI**: \`${step.customObject.uri}\`\n`;
  }

  if (step.mappings && step.mappings.length > 0) {
    md += `\n**Mappings** (${step.mappings.length}):\n\n`;
    md += formatMappings(step.mappings);
    md += '\n';
  }

  md += '---\n\n';
  return md;
}

/* ================================================================== */
/*  Sub-decision fetching for export                                   */
/* ================================================================== */

function extractSubDecisionUris(steps: Step[]): string[] {
  const uris: string[] = [];
  for (const step of steps) {
    if (step.customObject?.type === 'decision') {
      uris.push(step.customObject.uri);
    }
    if (step.onTrue) uris.push(...extractSubDecisionUris(extractSteps(step.onTrue)));
    if (step.onFalse) uris.push(...extractSubDecisionUris(extractSteps(step.onFalse)));
    if (step.steps) uris.push(...extractSubDecisionUris(step.steps));
    if (step.branchCases) {
      for (const bc of step.branchCases) {
        if (bc.onTrue) uris.push(...extractSubDecisionUris(extractSteps(bc.onTrue)));
      }
      if (step.defaultCase) uris.push(...extractSubDecisionUris(extractSteps(step.defaultCase)));
    }
  }
  return uris;
}

async function fetchAllSubDecisions(
  flow: DecisionFlow,
  cache: Map<string, DecisionFlow>,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<void> {
  if (depth >= maxDepth) return;
  const steps = flow.flow?.steps ?? [];
  const uris = [...new Set(extractSubDecisionUris(steps))];
  const newUris = uris.filter((uri) => !cache.has(uri));
  if (newUris.length === 0) return;

  const results = await Promise.allSettled(
    newUris.map((uri) => getDecisionRevision(uri)),
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      const subFlow = (results[i] as PromiseFulfilledResult<DecisionFlow>).value;
      cache.set(newUris[i], subFlow);
      await fetchAllSubDecisions(subFlow, cache, depth + 1, maxDepth);
    }
  }
}

/* ================================================================== */
/*  Main export function (async — fetches all details)                 */
/* ================================================================== */

export interface ExportProgress {
  current: number;
  total: number;
  nodeName: string;
  phase?: string;
}

export async function generateMarkdownExport(
  flow: DecisionFlow,
  onProgress?: (progress: ExportProgress) => void,
  existingSubDecisionCache?: Map<string, DecisionFlow>,
): Promise<string> {
  const subDecisionCache = new Map<string, DecisionFlow>(existingSubDecisionCache ?? []);
  onProgress?.({ current: 0, total: 0, nodeName: '', phase: 'Fetching sub-decisions...' });
  await fetchAllSubDecisions(flow, subDecisionCache);

  const mermaid = generateMermaid(flow, subDecisionCache);
  const sig = flow.signature ?? [];
  const inputs = sig.filter((s) => s.direction === 'input' || s.direction === 'inOut');
  const outputs = sig.filter((s) => s.direction === 'output');
  const steps = flow.flow?.steps ?? [];
  const nodes = collectNodes(steps, subDecisionCache, 0);

  const decisionDL = buildDecisionDeepLink(flow.id);

  // Table of Contents
  let toc = '## Table of Contents\n\n';
  toc += '- [Overview](#overview)\n';
  if (inputs.length > 0 || outputs.length > 0) toc += '- [Variables](#variables)\n';
  toc += '- [Flow Diagram](#flow-diagram)\n';
  if (nodes.length > 0) {
    toc += '- [Node Details](#node-details)\n';
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.isSubDecisionEnd) continue;
      const indent = '  '.repeat(n.depth + 1);
      const prefix = n.isSubDecisionStart ? `Sub-Decision: ${n.name}` : `${i + 1}. ${n.name}`;
      toc += `${indent}- [${prefix}](#${n.anchor})\n`;
    }
  }
  toc += '\n';

  // Overview
  let md = `# ${flow.name}\n\n`;
  md += toc;
  md += '## Overview\n\n';
  if (decisionDL) md += `> [${decisionDL.label}](${decisionDL.url})\n\n`;
  md += `- **ID**: \`${flow.id}\`\n`;
  md += `- **Version**: ${flow.majorRevision}.${flow.minorRevision}\n`;
  md += `- **Created by**: ${flow.createdBy}\n`;
  md += `- **Modified by**: ${flow.modifiedBy}\n`;
  md += `- **Created**: ${flow.creationTimeStamp}\n`;
  md += `- **Modified**: ${flow.modifiedTimeStamp}\n`;
  if (flow.validationStatus) md += `- **Validation Status**: ${flow.validationStatus}\n`;
  if (flow.description) md += `\n${flow.description}\n`;

  // Variables
  if (inputs.length > 0 || outputs.length > 0) {
    md += '\n## Variables\n\n';
    md += '| Name | Type | Direction | Length | Description |\n|------|------|-----------|--------|-------------|\n';
    for (const v of [...inputs, ...outputs]) {
      md += `| \`${v.name}\` | ${v.dataType} | ${v.direction} | ${v.length ?? '\u2014'} | ${v.description ?? ''} |\n`;
    }
  }

  // Diagram
  md += '\n## Flow Diagram\n\n';
  md += '```mermaid\n' + mermaid + '\n```\n';

  // Node Details
  if (nodes.length > 0) {
    md += '\n## Node Details\n\n';

    const displayNodes = nodes.filter((n) => !n.isSubDecisionEnd);
    md += `This decision flow contains **${displayNodes.length}** nodes`;
    const subCount = nodes.filter((n) => n.isSubDecisionStart).length;
    if (subCount > 0) md += ` (including **${subCount}** expanded sub-decision${subCount > 1 ? 's' : ''})`;
    md += '.\n\n';

    // Summary table
    md += '| # | Name | Type | Depth |\n|---|------|------|-------|\n';
    nodes.forEach((node, i) => {
      if (node.isSubDecisionEnd) return;
      const depthIndicator = node.depth > 0 ? '\u21B3'.repeat(node.depth) + ' ' : '';
      const displayName = node.isSubDecisionStart ? `**Sub: ${node.name}**` : node.name;
      md += `| ${i + 1} | ${depthIndicator}[${displayName}](#${node.anchor}) | ${node.typeLabel} | ${node.depth} |\n`;
    });
    md += '\n';

    // Fetch all node details in parallel (batch of 5)
    const detailsMap = new Map<number, FetchedNodeDetails>();
    const fetchableNodes = nodes
      .map((n, i) => ({ node: n, index: i }))
      .filter(({ node }) => !node.isSubDecisionEnd);
    const batchSize = 5;
    for (let batch = 0; batch < fetchableNodes.length; batch += batchSize) {
      const batchItems = fetchableNodes.slice(batch, batch + batchSize);
      const batchResults = await Promise.allSettled(
        batchItems.map(({ node, index }) => {
          onProgress?.({
            current: batch + batchItems.indexOf(batchItems.find((b) => b.index === index)!) + 1,
            total: fetchableNodes.length,
            nodeName: node.name,
            phase: 'Fetching node details',
          });
          return fetchNodeDetails(node.step, subDecisionCache);
        }),
      );
      batchResults.forEach((result, bi) => {
        if (result.status === 'fulfilled') {
          detailsMap.set(batchItems[bi].index, result.value);
        }
      });
    }

    // Detailed sections for each node
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.isSubDecisionEnd) {
        md += formatNodeSection(node, i, {});
        continue;
      }
      const details = detailsMap.get(i) ?? {};
      md += `<a id="${node.anchor}"></a>\n\n`;
      md += formatNodeSection(node, i, details);
    }
  }

  md += '\n---\n\n*Generated by SAS MAS Scorer*\n';

  return md;
}
