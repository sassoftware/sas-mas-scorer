// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

export interface ModelVariable {
  name: string;
  description?: string;
  role?: string;
  type?: string;
  level?: string;
  format?: string;
  length?: number;
}

export interface ModelProperty {
  name: string;
  value: string;
  type?: string;
}

export interface SidModelDetail {
  id: string;
  name: string;
  description?: string;
  algorithm?: string;
  algorithmName?: string;
  function?: string;
  tool?: string;
  toolVersion?: string;
  modeler?: string;
  scoreCodeType?: string;
  trainTable?: string;
  targetVariable?: string;
  targetEvent?: string;
  targetLevel?: string;
  eventProbVar?: string;
  champion?: boolean;
  role?: string;
  projectId?: string;
  projectName?: string;
  projectVersionName?: string;
  projectVersionNum?: number;
  retrainable?: boolean;
  modelVersionName?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  properties?: ModelProperty[];
  inputVariables?: ModelVariable[];
  outputVariables?: ModelVariable[];
  [key: string]: unknown;
}

export async function getSidModel(id: string): Promise<SidModelDetail> {
  const response = await sasViyaClient.get<SidModelDetail>(
    `/modelRepository/models/${id}`,
    { headers: { Accept: 'application/vnd.sas.models.model+json' } },
  );
  return response.data;
}
