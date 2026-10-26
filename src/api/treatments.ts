// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { cachedRequest, sidDocumentPolicy, type RequestOptions } from './requestCache';

export interface TreatmentAttributeConstraints {
  dataType: string;
  format?: string;
  multiple?: boolean;
  range?: boolean;
  required?: boolean;
  readOnly?: boolean;
  enum?: unknown[];
  minimum?: unknown;
  maximum?: unknown;
  minLength?: number;
  maxLength?: number;
}

export interface TreatmentAttribute {
  id?: string;
  name: string;
  description?: string;
  defaultValue?: unknown;
  valueConstraints?: TreatmentAttributeConstraints;
}

export interface TreatmentEligibility {
  ruleSetUri?: string;
  ruleSetName?: string;
  startDate?: string;
  endDate?: string;
}

export interface TreatmentDefinitionDetail {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  majorRevision?: number;
  minorRevision?: number;
  status?: string;
  eligibility?: TreatmentEligibility;
  attributes?: TreatmentAttribute[];
  [key: string]: unknown;
}

export interface TreatmentGroupMember {
  definitionId: string;
  definitionName?: string;
  definitionRevisionId?: string;
  definitionRevisionName?: string;
  attributeValueMappings?: unknown[];
  attributeNameAliases?: unknown[];
}

export interface TreatmentGroupDetail {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  modifiedBy?: string;
  creationTimeStamp?: string;
  modifiedTimeStamp?: string;
  majorRevision?: number;
  minorRevision?: number;
  activationStatus?: string;
  status?: string;
  members?: TreatmentGroupMember[];
  [key: string]: unknown;
}

const DEFINITION_ACCEPT = 'application/vnd.sas.treatment.definition+json';
const GROUP_ACCEPT = 'application/vnd.sas.treatment.definition.group+json';

/**
 * One cached GET per URI and media type (see requestCache.ts). A locked
 * revision is kept for the session, anything else is re-checked after a
 * minute.
 */
function getTreatmentDocument<T>(kind: string, uri: string, accept: string, options?: RequestOptions): Promise<T> {
  return cachedRequest(
    `${kind}:${uri}`,
    async () => {
      const response = await sasViyaClient.get<T>(uri, { headers: { Accept: accept } });
      return response.data;
    },
    sidDocumentPolicy<T>(uri),
    options,
  );
}

export async function getTreatmentDefinition(
  id: string,
  options?: RequestOptions,
): Promise<TreatmentDefinitionDetail> {
  return getTreatmentDocument('treatmentDefinition', `/treatmentDefinitions/definitions/${id}`, DEFINITION_ACCEPT, options);
}

export async function getTreatmentDefinitionByRevision(
  definitionId: string,
  revisionId: string,
  options?: RequestOptions,
): Promise<TreatmentDefinitionDetail> {
  return getTreatmentDocument(
    'treatmentDefinition',
    `/treatmentDefinitions/definitions/${definitionId}/revisions/${revisionId}`,
    DEFINITION_ACCEPT,
    options,
  );
}

export async function getTreatmentGroup(id: string, options?: RequestOptions): Promise<TreatmentGroupDetail> {
  return getTreatmentDocument('treatmentGroup', `/treatmentDefinitions/definitionGroups/${id}`, GROUP_ACCEPT, options);
}

export async function getTreatmentGroupByUri(uri: string, options?: RequestOptions): Promise<TreatmentGroupDetail> {
  return getTreatmentDocument('treatmentGroup', uri, GROUP_ACCEPT, options);
}
