// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';

/** A decision variable a rule condition or action reads or assigns. */
export interface RuleTermRef {
  id?: string;
  name: string;
  dataType?: string;
  /** input | output | inOut | none */
  direction?: string;
  description?: string;
}

/** A lookup table or advanced list a rule element depends on. */
export interface RuleObjectRef {
  id?: string;
  name?: string;
  version?: number;
}

interface RuleElementBase {
  id?: string;
  expression?: string;
  term?: RuleTermRef;
  /**
   * Present but empty on elements that read no lookup table, so callers must
   * check for a name rather than for the object itself.
   */
  lookup?: RuleObjectRef;
  /** The terms the expression reads. */
  expressionUnits?: Array<{ term?: RuleTermRef }>;
  status?: string;
  statusMessage?: string;
}

/** Condition types seen in the wild: complex, decisionTable, lookup. */
export interface RuleCondition extends RuleElementBase {
  type?: string;
}

/** Action types seen in the wild: assignment, complex, lookupValue, listQuery. */
export interface RuleAction extends RuleElementBase {
  type?: string;
  /** The advanced list a listQuery action reads from. */
  advancedList?: RuleObjectRef;
  /** The terms a listQuery action assigns. */
  terms?: RuleTermRef[];
}

export interface BusinessRule {
  id: string;
  name: string;
  description?: string;
  /** if | elseif | else | or — chains this rule to the one before it. */
  conditional?: string;
  ruleFiredTrackingEnabled?: boolean;
  status?: string;
  statusMessage?: string;
  version?: number;
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
  /** assignment | filtering */
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

/**
 * The rules collection defaults to 10 items, so it must be paged explicitly —
 * without this a 46-rule rule set silently reports itself as having 10. The
 * shared walker also honours the limit the service echoes back, so a capped
 * page continues rather than ending the walk.
 * The service sorts by ruleExecutionSeqNo, so the result is in execution order.
 */
const RULES_PAGE_SIZE = 100;

export async function getRuleSetRules(id: string): Promise<BusinessRule[]> {
  return fetchAllPaginated<BusinessRule>(`/businessRules/ruleSets/${id}/rules`, {
    pageSize: RULES_PAGE_SIZE,
  });
}

/** A rule set together with its complete rule list. */
export interface RuleSetBundle {
  detail: RuleSetDetail;
  rules: BusinessRule[];
}

/**
 * Fetches the unit the flow diagram, the side panel and the Markdown export all
 * need. A failure to read the rules is tolerated — the rule set itself is not.
 */
export async function getRuleSetBundle(id: string): Promise<RuleSetBundle> {
  const [detail, rules] = await Promise.allSettled([getRuleSet(id), getRuleSetRules(id)]);
  if (detail.status === 'rejected') throw detail.reason;
  return {
    detail: detail.value,
    rules: rules.status === 'fulfilled' ? rules.value : [],
  };
}
