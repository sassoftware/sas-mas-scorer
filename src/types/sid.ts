// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/* ------------------------------------------------------------------ */
/*  SAS Intelligent Decisioning — JSON type definitions                */
/* ------------------------------------------------------------------ */

export interface SidLink {
  method?: string;
  rel: string;
  href: string;
  uri: string;
  type?: string;
  responseType?: string;
}

export interface SignatureVar {
  id: string;
  name: string;
  direction: 'input' | 'output' | 'inOut' | 'none';
  dataType: string;
  length?: number;
  defaultValue?: unknown;
  description?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  createdBy?: string;
  modifiedBy?: string;
}

export interface StepMapping {
  id?: string;
  targetDecisionTermName: string;
  direction: string;
  stepTermName: string;
}

export interface CustomObject {
  uri: string;
  name: string;
  type: string;
  isRestDNT?: boolean;
}

export interface ConditionDef {
  lhsTerm?: { name: string; generateDataGridColumns?: boolean };
  operator?: string;
  rhsTerm?: { name: string } | null;
  rhsConstant?: string;
}

export interface RuleSetRef {
  id: string;
  name: string;
  versionId?: string;
  versionName?: string;
}

export interface ModelRef {
  id: string;
  name: string;
  versionId?: string;
  versionName?: string;
  algorithmName?: string;
}

export interface BranchBlock {
  id?: string;
  steps: Step[];
  creationTimeStamp?: string;
}

export interface BranchCase {
  id: string;
  label?: string;
  simpleCondition?: ConditionDef & { id?: string; lhsConditionExpression?: string; lhsConditionExpressionType?: string };
  compoundCondition?: unknown;
  onTrue?: BranchBlock | Step[] | Step;
}

export interface Step {
  id: string;
  type: string;
  name?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  customObject?: CustomObject;
  model?: ModelRef;
  ruleset?: RuleSetRef;
  condition?: ConditionDef;
  conditionExpression?: string;
  decisionNodeLinkTarget?: string | { nodeId: string };
  onTrue?: BranchBlock | Step[] | Step;
  onFalse?: BranchBlock | Step[] | Step;
  steps?: Step[];
  mappings?: StepMapping[];
  mappingDataGridName?: string;
  publishedModule?: unknown;
  links?: SidLink[];
  linkLabel?: string;
  branchCases?: BranchCase[];
  defaultCase?: BranchBlock;
  branchType?: string;
  assignments?: VariableAssignment[];
  abTestCases?: ABTestCase[];
  abTestType?: string;
  nodes?: ParallelNode[];
  recordContact?: RecordContactDef;
}

export interface VariableAssignment {
  id: string;
  variableId?: string;
  variableName: string;
  dataType?: string;
  value?: string;
}

export interface ABTestCase {
  id: string;
  label?: string;
  role?: string;
  percent?: number;
  onTrue?: BranchBlock | Step[] | Step;
}

export interface ParallelNode {
  id: string;
  uri?: string;
  name: string;
  links?: SidLink[];
}

export interface RecordContactDef {
  name?: string;
  ruleFiredTracking?: boolean;
  pathTracking?: boolean;
  excludeFromContactAggregation?: boolean;
  treatmentDatagridTerm?: string | null;
  responseTrackingVariableName?: string;
  channelTerm?: string | null;
  auditTerms?: unknown;
}

export interface DecisionFlow {
  id: string;
  name: string;
  description?: string;
  majorRevision: number;
  minorRevision: number;
  createdBy: string;
  modifiedBy: string;
  creationTimeStamp: string;
  modifiedTimeStamp: string;
  signature?: SignatureVar[];
  flow?: { steps: Step[] };
  links?: SidLink[];
  nodeCount?: number;
  folderType?: string;
  checkout?: boolean;
  validationStatus?: string;
  hasErrors?: boolean;
  hasWarnings?: boolean;
  hasErrorsInSubDecisions?: boolean;
  hasWarningsInSubDecisions?: boolean;
  subjectId?: { id: string; name: string };
  subjectLevel?: string;
  workflowDefinitionId?: string;
  properties?: Record<string, unknown>;
}

export interface WorkflowHistoryItem {
  statusChangedFrom: string;
  statusChangedTo: string;
  modifiedTimeStamp: number;
  modifiedBy: string;
  version: string;
  versionId: string;
  comments: string | null;
  workflowName: string;
  workflowVersion: number;
  workflowProcessId: string;
}

export interface WorkflowHistoryResponse {
  items: WorkflowHistoryItem[];
  revisions: string[];
  count: number;
}

export interface SidPaginatedResponse<T> {
  links?: SidLink[];
  name?: string;
  accept?: string;
  start: number;
  count: number;
  limit: number;
  items: T[];
}

/* ------------------------------------------------------------------ */
/*  React Flow node/edge data types                                    */
/* ------------------------------------------------------------------ */

export type SidNodeType =
  | 'start'
  | 'end'
  | 'decision'
  | 'custom'
  | 'ruleset'
  | 'model'
  | 'code_file'
  | 'condition'
  | 'cond_expr'
  | 'assignment'
  | 'abtest'
  | 'parallel'
  | 'record_contact'
  | 'treatment_group'
  | 'segmentation_tree'
  | 'unknown';

export interface SidNodeData {
  label: string;
  nodeType: SidNodeType;
  step?: Step;
  expression?: string;
  subDecisionId?: string;
  isGroup?: boolean;
  groupLabel?: string;
  groupType?: 'sub-decision' | 'parallel';
  [key: string]: unknown;
}
