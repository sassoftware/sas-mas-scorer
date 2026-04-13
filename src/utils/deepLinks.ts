// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { getSasViyaUrl } from '../config';

interface DeepLinkInfo {
  url: string;
  label: string;
}

const LINK_MAP: Record<string, { path: string; app: string }> = {
  decision:              { path: 'SASDecisionManager/decisions',          app: 'SAS Intelligent Decisioning' },
  ruleset:               { path: 'SASDecisionManager/rules',             app: 'SAS Intelligent Decisioning' },
  decisionPythonFile:    { path: 'SASDecisionManager/codeFiles',         app: 'SAS Intelligent Decisioning' },
  decisionDS2CodeFile:   { path: 'SASDecisionManager/codeFiles',         app: 'SAS Intelligent Decisioning' },
  decisionSQLCodeFile:   { path: 'SASDecisionManager/codeFiles',         app: 'SAS Intelligent Decisioning' },
  decisionQueryFile:     { path: 'SASDecisionManager/codeFiles',         app: 'SAS Intelligent Decisioning' },
  codeFile:              { path: 'SASDecisionManager/codeFiles',         app: 'SAS Intelligent Decisioning' },
  treatmentGroup:        { path: 'SASDecisionManager/treatmentGroups',   app: 'SAS Intelligent Decisioning' },
  treatment:             { path: 'SASDecisionManager/treatments',        app: 'SAS Intelligent Decisioning' },
  segmentationTree:      { path: 'SASDecisionManager/segmentationTrees', app: 'SAS Intelligent Decisioning' },
  reference:             { path: 'SASDecisionManager/references',        app: 'SAS Intelligent Decisioning' },
  globalVariable:        { path: 'SASDecisionManager/globalVariables',   app: 'SAS Intelligent Decisioning' },
  valueList:             { path: 'SASDecisionManager/valueLists',        app: 'SAS Intelligent Decisioning' },
  model:                 { path: 'SASModelManager/models',               app: 'SAS Model Manager' },
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function extractUuid(uri: string): string | null {
  const matches = uri.match(UUID_RE);
  return matches ? matches[0] : null;
}

export function buildDeepLink(assetType: string, uriOrId: string): DeepLinkInfo | null {
  const entry = LINK_MAP[assetType];
  if (!entry) return null;

  const serverUrl = getSasViyaUrl();
  if (!serverUrl) return null;

  const uuid = extractUuid(uriOrId);
  if (!uuid) return null;

  return {
    url: `${serverUrl}/${entry.path}/${uuid}`,
    label: `Open in ${entry.app}`,
  };
}

export function buildDecisionDeepLink(decisionId: string): DeepLinkInfo | null {
  return buildDeepLink('decision', decisionId);
}

export function buildRuleSetDeepLink(ruleSetId: string): DeepLinkInfo | null {
  return buildDeepLink('ruleset', ruleSetId);
}

export function buildModelDeepLink(modelId: string): DeepLinkInfo | null {
  return buildDeepLink('model', modelId);
}

export function buildCustomObjectDeepLink(customObjectType: string, uri: string): DeepLinkInfo | null {
  return buildDeepLink(customObjectType, uri);
}
