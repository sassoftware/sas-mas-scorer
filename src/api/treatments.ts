// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

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

export async function getTreatmentDefinition(id: string): Promise<TreatmentDefinitionDetail> {
  const response = await sasViyaClient.get<TreatmentDefinitionDetail>(
    `/treatmentDefinitions/definitions/${id}`,
    { headers: { Accept: 'application/vnd.sas.treatment.definition+json' } },
  );
  return response.data;
}

export async function getTreatmentDefinitionByRevision(
  definitionId: string,
  revisionId: string,
): Promise<TreatmentDefinitionDetail> {
  const response = await sasViyaClient.get<TreatmentDefinitionDetail>(
    `/treatmentDefinitions/definitions/${definitionId}/revisions/${revisionId}`,
    { headers: { Accept: 'application/vnd.sas.treatment.definition+json' } },
  );
  return response.data;
}

export async function getTreatmentGroup(id: string): Promise<TreatmentGroupDetail> {
  const response = await sasViyaClient.get<TreatmentGroupDetail>(
    `/treatmentDefinitions/definitionGroups/${id}`,
    { headers: { Accept: 'application/vnd.sas.treatment.definition.group+json' } },
  );
  return response.data;
}

export async function getTreatmentGroupByUri(uri: string): Promise<TreatmentGroupDetail> {
  const response = await sasViyaClient.get<TreatmentGroupDetail>(
    uri,
    { headers: { Accept: 'application/vnd.sas.treatment.definition.group+json' } },
  );
  return response.data;
}
