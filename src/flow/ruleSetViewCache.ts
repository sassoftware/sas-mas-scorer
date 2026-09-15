// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { RuleSetBundle } from '../api/rulesets';
import { buildRuleSetView, type RuleSetView } from '../utils/ruleSetView';

/**
 * The readable view of a rule set, computed once per fetched bundle.
 *
 * The diagram converter, the side panel and the Markdown export all derive
 * the same view from the same bundle; keying on the bundle object (which the
 * page caches by rule set id) means a graph rebuild costs a Map lookup per
 * rule set node instead of a fresh pass over every rule.
 */
const views = new WeakMap<RuleSetBundle, RuleSetView>();

export function ruleSetViewOf(bundle: RuleSetBundle): RuleSetView {
  let view = views.get(bundle);
  if (!view) {
    view = buildRuleSetView(bundle.rules);
    views.set(bundle, view);
  }
  return view;
}
