// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SAS Intelligent Decisioning REST API definitions.
 *
 * A decision references a definition as a custom-object step whose
 * `customObject.uri` is the *revision* URI
 * (`/decisions/restApiDefinitions/{id}/revisions/{revisionId}`). GETting that
 * URI returns the same full definition body as the base resource, so the step
 * URI can be used directly — no id/revision splitting required.
 */

import { sasViyaClient } from './client';
import type { SidLink, StepMapping } from '../types/sid';

const DEFINITION_ACCEPT = 'application/vnd.sas.decision.rest.api.definition+json';

/** customObject.type of a REST API definition step. */
export const REST_API_DEFINITION_TYPE = 'decisionRESTAPIDefinition';

/** Query parameter or header. `value` may contain `{term}` placeholders. */
export interface RestApiParam {
  key: string;
  value?: string;
  description?: string;
}

/** A term of the definition signature — the step's inputs and outputs. */
export interface RestApiTerm {
  id?: string;
  name: string;
  dataType: string;
  direction: string;
  description?: string;
  length?: number;
  defaultValue?: unknown;
  /** True for the service-supplied outputs responseBody and responseStatusCode. */
  readOnly?: boolean;
}

export interface RestApiDefinitionDetail {
  /**
   * Definition id when fetched from the base resource, but the REVISION id when
   * fetched from a revision URI (a revision response carries no revisionId /
   * revisionUri). Derive the definition id from the URI you requested — the
   * first UUID of the step's customObject.uri — never from this field.
   */
  id: string;
  name: string;
  description?: string;
  method?: string;
  /** Endpoint template, e.g. `https://v2.jokeapi.dev/joke/{jokeCategory}`. */
  uriTemplate?: string;
  queryParams?: RestApiParam[];
  requestHeaders?: RestApiParam[];
  responseHeaders?: RestApiParam[];
  requestBody?: string;
  requestBodyFormat?: string;
  authorization?: { authorizationType?: string; id?: string };
  signature?: RestApiTerm[];
  majorRevision?: number;
  minorRevision?: number;
  revisionId?: string;
  revisionUri?: string;
  locked?: boolean;
  checkout?: boolean;
  /** 'folder' for live definitions, 'trashFolder' once deleted. */
  folderType?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  links?: SidLink[];
}

/** Display labels for authorization.authorizationType. */
export const AUTH_TYPE_LABELS: Record<string, string> = {
  NONE: 'None (anonymous)',
  SAS_OAUTH: 'SAS OAuth (caller token)',
  BASIC: 'Basic authentication',
  BEARER_TOKEN: 'Bearer token',
  API_KEY: 'API key',
  OAUTH_CLIENT_CREDENTIALS: 'OAuth client credentials',
};

export function authTypeLabel(type?: string): string {
  if (!type) return 'Not specified';
  return AUTH_TYPE_LABELS[type] ?? type;
}

export async function getRestApiDefinitionByUri(uri: string): Promise<RestApiDefinitionDetail> {
  const response = await sasViyaClient.get<RestApiDefinitionDetail>(uri, {
    headers: { Accept: DEFINITION_ACCEPT },
  });
  return response.data;
}

/** Names inside `{...}` placeholders — each binds a signature term into the request. */
export function extractPlaceholders(text?: string): string[] {
  if (!text) return [];
  const names: string[] = [];
  const re = /\{([^{}\s]+)\}/g;
  let match = re.exec(text);
  while (match !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
    match = re.exec(text);
  }
  return names;
}

/** Host of a uriTemplate, for compact display. Placeholders are kept verbatim. */
export function uriTemplateHost(uriTemplate?: string): string {
  if (!uriTemplate) return '';
  const match = uriTemplate.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/);
  return match ? match[1] : '';
}

/**
 * Decision variable a single-placeholder value resolves to, via the step mappings.
 * Returns null for literals and for values that combine several placeholders.
 */
export function boundDecisionVariable(
  value: string | undefined,
  mappings?: StepMapping[],
): string | null {
  const names = extractPlaceholders(value);
  if (names.length !== 1 || !mappings) return null;
  const mapping = mappings.find((m) => m.stepTermName === names[0]);
  return mapping ? mapping.targetDecisionTermName : null;
}
