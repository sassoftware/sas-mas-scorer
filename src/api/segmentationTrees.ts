// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

export interface SegTreeSignatureVar {
  id: string;
  name: string;
  dataType: string;
  direction: string;
  length?: number;
  description?: string;
  defaultValue?: unknown;
}

export interface SegTreeOutcomeAction {
  type: string;
  variableName: string;
  valueType: string;
  value: string;
}

export interface SegTreeOutcome {
  name: string;
  description?: string;
  actions?: SegTreeOutcomeAction[];
}

export interface SegTreeBooleanExpression {
  name: string;
  description?: string | null;
  expression: string;
}

export interface SegTreeValueNode {
  id: string;
  label: string;
  value: string;
  next?: SegTreeNode | null;
  outcomeName?: string | null;
  variableAssignmentOutcomeActionOverrides?: unknown[];
}

export interface SegTreeNode {
  type: string;
  id: string;
  label: string;
  valueNodes: SegTreeValueNode[];
  booleanExpressionName?: string;
}

export interface SegmentationTreeDetail {
  id: string;
  name: string;
  description?: string;
  majorRevision?: number;
  minorRevision?: number;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  signature?: SegTreeSignatureVar[];
  outcomes?: SegTreeOutcome[];
  booleanExpressions?: SegTreeBooleanExpression[];
  node?: SegTreeNode;
}

export async function getSegmentationTree(uri: string): Promise<SegmentationTreeDetail> {
  const response = await sasViyaClient.get<SegmentationTreeDetail>(
    uri,
    { headers: { Accept: 'application/vnd.sas.decision.segmentation.tree+json' } },
  );
  return response.data;
}
