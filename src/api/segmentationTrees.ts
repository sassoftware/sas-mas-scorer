// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';
import { cachedRequest, IN_FLIGHT_ONLY, sidDocumentPolicy, type RequestOptions } from './requestCache';

const TREE_MEDIA_TYPE = 'application/vnd.sas.decision.segmentation.tree+json';

/**
 * Trees kept for the session. A large tree is about 1 MB of uncompressed JSON
 * (and takes about 0.4 s on a LAN), so a handful is enough to make going back
 * and forth instant without holding much memory.
 */
const MAX_CACHED_TREES = 5;

const TREES_PAGE_SIZE = 200;

/** Request-cache key of a tree by the URI it is read from. */
export const segmentationTreeCacheKey = (uri: string): string => `segTree:${uri}`;

/** The current tree behind an id, as `getSegmentationTreeById` reads it. */
export const segmentationTreeUri = (id: string): string =>
  `/decisions/segmentationTrees/${encodeURIComponent(id)}`;

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

function getTreeDocument(
  uri: string,
  timeout: number | undefined,
  options?: RequestOptions,
): Promise<SegmentationTreeDetail> {
  return cachedRequest(
    segmentationTreeCacheKey(uri),
    async () => {
      const response = await sasViyaClient.get<SegmentationTreeDetail>(uri, {
        headers: { Accept: TREE_MEDIA_TYPE },
        ...(timeout !== undefined ? { timeout } : {}),
      });
      return response.data;
    },
    sidDocumentPolicy<SegmentationTreeDetail>(uri, MAX_CACHED_TREES),
    options,
  );
}

/** A tree (or tree revision) by URI. Cached for the session, see requestCache.ts. */
export async function getSegmentationTree(
  uri: string,
  options?: RequestOptions,
): Promise<SegmentationTreeDetail> {
  return getTreeDocument(uri, undefined, options);
}

/**
 * The current revision of a tree. A large tree is around 1 MB of JSON.
 * Cached for the session, see requestCache.ts; pass `{ refresh: true }` to
 * skip the stored copy.
 */
export async function getSegmentationTreeById(
  id: string,
  options?: RequestOptions,
): Promise<SegmentationTreeDetail> {
  return getTreeDocument(segmentationTreeUri(id), 120000, options);
}

/**
 * Every segmentation tree, name ascending. Identical calls running at the
 * same time share one walk; the result is not kept here (the list page keeps
 * its own copy).
 */
export async function listAllSegmentationTrees(): Promise<SegmentationTreeSummary[]> {
  return cachedRequest(
    'segTreeList:',
    () =>
      fetchAllPaginated<SegmentationTreeSummary>('/decisions/segmentationTrees', {
        params: { sortBy: 'name:ascending' },
        pageSize: TREES_PAGE_SIZE,
      }),
    IN_FLIGHT_ONLY,
  );
}
