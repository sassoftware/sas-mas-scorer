// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';

const TREE_MEDIA_TYPE = 'application/vnd.sas.decision.segmentation.tree+json';

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
  /** `static` for a literal; anything else assigns from a variable or expression. */
  valueType: string;
  /** Numbers arrive as JSON numbers, strings as strings. */
  value: string | number | boolean | null;
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
  /**
   * The branch condition: a value-list key such as `17<=v<600` or `v>=1`, a
   * literal value, or `__&OTHER&__` for the catch-all branch.
   */
  value: string;
  next?: SegTreeNode | null;
  outcomeName?: string | null;
  variableAssignmentOutcomeActionOverrides?: unknown[];
}

export interface SegTreeNode {
  /** `variable` for a split on an input; boolean-expression splits use another type. */
  type: string;
  id: string;
  label: string;
  variableName?: string;
  valueNodes: SegTreeValueNode[];
  booleanExpressionName?: string;
}

export interface SegmentationTreeDetail {
  id: string;
  name: string;
  description?: string;
  majorRevision?: number;
  minorRevision?: number;
  revisionId?: string;
  revisionUri?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  signature?: SegTreeSignatureVar[];
  outcomes?: SegTreeOutcome[];
  booleanExpressions?: SegTreeBooleanExpression[];
  node?: SegTreeNode;
}

/** Collection item of /decisions/segmentationTrees. */
export interface SegmentationTreeSummary {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
}

export async function getSegmentationTree(uri: string): Promise<SegmentationTreeDetail> {
  const response = await sasViyaClient.get<SegmentationTreeDetail>(
    uri,
    { headers: { Accept: TREE_MEDIA_TYPE } },
  );
  return response.data;
}

/** The current revision of a tree. A large tree is around 1 MB of JSON. */
export async function getSegmentationTreeById(id: string): Promise<SegmentationTreeDetail> {
  const response = await sasViyaClient.get<SegmentationTreeDetail>(
    `/decisions/segmentationTrees/${encodeURIComponent(id)}`,
    { headers: { Accept: TREE_MEDIA_TYPE }, timeout: 120000 },
  );
  return response.data;
}

/** Every segmentation tree, name ascending. */
export async function listAllSegmentationTrees(): Promise<SegmentationTreeSummary[]> {
  return fetchAllPaginated<SegmentationTreeSummary>('/decisions/segmentationTrees', {
    params: { sortBy: 'name:ascending' },
    pageSize: 100,
  });
}
