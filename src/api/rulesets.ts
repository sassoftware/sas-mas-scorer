// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated } from './paginate';
import {
  cachedRequest,
  invalidateRequestCache,
  sidDocumentPolicy,
  type CachePolicy,
  type RequestOptions,
} from './requestCache';

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

/**
 * Request-cache keys all start with this, so `invalidateRuleSetCache` can drop
 * every rule set, rule list and bundle at once.
 */
const RULE_SET_KEY_PREFIX = 'ruleSet';

/** Rule sets (and, separately, rule lists and bundles) kept for the session. */
const MAX_CACHED_RULE_SETS = 300;

/**
 * Forget every cached rule set. Call after anything that changes rule sets
 * (the CSV import does this itself).
 */
export function invalidateRuleSetCache(): void {
  invalidateRequestCache(RULE_SET_KEY_PREFIX);
}

function ruleSetPolicy<T>(): CachePolicy<T> {
  // Read by id, so always the current revision: never treated as immutable.
  return sidDocumentPolicy<T>(`/businessRules/ruleSets`, MAX_CACHED_RULE_SETS);
}

async function fetchRuleSet(id: string): Promise<RuleSetDetail> {
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
 * page continues rather than ending the walk. The service accepts 1,000 per
 * page, so nearly every rule set is a single request.
 * The service sorts by ruleExecutionSeqNo, so the result is in execution order.
 */
const RULES_PAGE_SIZE = 1000;

function fetchRuleSetRules(id: string): Promise<BusinessRule[]> {
  return fetchAllPaginated<BusinessRule>(`/businessRules/ruleSets/${id}/rules`, {
    pageSize: RULES_PAGE_SIZE,
  });
}

/** The current rule set. Cached for the session, see requestCache.ts. */
export async function getRuleSet(id: string, options?: RequestOptions): Promise<RuleSetDetail> {
  return cachedRequest(`${RULE_SET_KEY_PREFIX}:${id}`, () => fetchRuleSet(id), ruleSetPolicy(), options);
}

/** Every rule of the current rule set, in execution order. Cached for the session. */
export async function getRuleSetRules(id: string, options?: RequestOptions): Promise<BusinessRule[]> {
  return cachedRequest(
    `${RULE_SET_KEY_PREFIX}Rules:${id}`,
    () => fetchRuleSetRules(id),
    ruleSetPolicy(),
    options,
  );
}

/** A rule set together with its complete rule list. */
export interface RuleSetBundle {
  detail: RuleSetDetail;
  rules: BusinessRule[];
}

/** Request-cache key of the bundle of a rule set. */
export const ruleSetBundleCacheKey = (id: string): string => `${RULE_SET_KEY_PREFIX}Bundle:${id}`;

/** Bundles whose rule list could not be read; returned once, never cached. */
const incompleteBundles = new WeakSet<RuleSetBundle>();

/**
 * Fetches the unit the flow diagram, the side panel and the Markdown export all
 * need. A failure to read the rules is tolerated — the rule set itself is not.
 *
 * Cached for the session as one unit (see requestCache.ts), so the same
 * bundle object comes back on every visit and per-bundle memos stay valid.
 * A bundle whose rules could not be read is not kept.
 */
export async function getRuleSetBundle(id: string, options?: RequestOptions): Promise<RuleSetBundle> {
  return cachedRequest<RuleSetBundle>(
    ruleSetBundleCacheKey(id),
    async () => {
      const [detail, rules] = await Promise.allSettled([fetchRuleSet(id), fetchRuleSetRules(id)]);
      if (detail.status === 'rejected') throw detail.reason;
      const bundle: RuleSetBundle = {
        detail: detail.value,
        rules: rules.status === 'fulfilled' ? rules.value : [],
      };
      if (rules.status === 'rejected') incompleteBundles.add(bundle);
      return bundle;
    },
    {
      ...ruleSetPolicy<RuleSetBundle>(),
      // An empty rule list from a failed read must not stick for the session.
      keep: (bundle) => !incompleteBundles.has(bundle),
    },
    options,
  );
}
