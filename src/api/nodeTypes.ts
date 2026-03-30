// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

export interface DecisionNodeTypeDetail {
  id: string;
  name: string;
  description?: string;
  hasProperties?: boolean;
  hasInputs?: boolean;
  hasOutputs?: boolean;
  inputDatagridMappable?: boolean;
  outputDatagridMappable?: boolean;
  themeId?: string;
  style?: {
    icon?: { id?: string; ref?: string };
    color?: number;
  };
  type?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  [key: string]: unknown;
}

export async function getDecisionNodeType(id: string): Promise<DecisionNodeTypeDetail> {
  const response = await sasViyaClient.get<DecisionNodeTypeDetail>(
    `/decisions/decisionNodeTypes/${id}`,
    { headers: { Accept: 'application/vnd.sas.decision.node.type+json' } },
  );
  return response.data;
}
