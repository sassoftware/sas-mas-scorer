// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

export interface RuleCondition {
  id?: string;
  type?: string;
  expression?: string;
  term?: { name: string; dataType?: string };
  status?: string;
  statusMessage?: string;
}

export interface RuleAction {
  id?: string;
  type?: string;
  expression?: string;
  term?: { name: string; dataType?: string };
  status?: string;
  statusMessage?: string;
}

export interface BusinessRule {
  id: string;
  name: string;
  description?: string;
  conditional?: string;
  ruleFiredTrackingEnabled?: boolean;
  status?: string;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

export interface RuleSetSignatureTerm {
  id?: string;
  name: string;
  dataType: string;
  direction: string;
  description?: string;
  defaultValue?: unknown;
  length?: number;
}

export interface RuleSetDetail {
  id: string;
  name: string;
  description?: string;
  ruleSetType?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  majorRevision?: number;
  minorRevision?: number;
  status?: string;
  signature?: RuleSetSignatureTerm[];
  rules?: BusinessRule[];
  [key: string]: unknown;
}

export async function getRuleSet(id: string): Promise<RuleSetDetail> {
  const response = await sasViyaClient.get<RuleSetDetail>(
    `/businessRules/ruleSets/${id}`,
    { headers: { Accept: 'application/vnd.sas.brm.rule.set+json' } },
  );
  return response.data;
}

export async function getRuleSetRules(id: string): Promise<BusinessRule[]> {
  const response = await sasViyaClient.get<{ items?: BusinessRule[] }>(
    `/businessRules/ruleSets/${id}/rules`,
    { headers: { Accept: 'application/vnd.sas.collection+json' } },
  );
  return response.data.items ?? [];
}
