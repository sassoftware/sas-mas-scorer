// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Link, Collection } from './mas';

export type PublishedKind = 'model' | 'decision' | 'unknown';

export interface DestinationProperty {
  name: string;
  value?: string;
}

export interface PublishDestination {
  id: string;
  name: string;
  description?: string;
  destinationType: string;
  createdBy?: string;
  creationTimeStamp?: string;
  modifiedBy?: string;
  modifiedTimeStamp?: string;
  version?: number;
  links?: Link[];

  // Type-specific fields (presence depends on destinationType)
  casServerName?: string;
  casLibrary?: string;
  destinationTable?: string;
  databaseHost?: string;
  databasePort?: number;
  databaseSchema?: string;
  properties?: DestinationProperty[];
}

export interface MasModule {
  jobUri?: string;
  modelName?: string;
}

export interface PublishedItemProperties {
  masModules?: MasModule[];
}

export interface PublishedItem {
  id: string;
  name: string;
  publishName: string;
  publishType?: string;
  publishLevel?: string;
  publishNote?: string;
  codeType?: string;
  createdBy?: string;
  creationTimeStamp: string;
  modifiedBy?: string;
  modifiedTimeStamp?: string;
  state: string;
  sourceUri: string;
  destinationName: string;
  destination: PublishDestination;
  modelId?: string;
  modelVersionId?: string;
  projectId?: string;
  projectVersionId?: string;
  principalId?: string;
  note?: string;
  properties?: PublishedItemProperties;
  analyticStoreUri?: string[];
  links?: Link[];
  version?: number;
}

export type PublishDestinationCollection = Collection<PublishDestination>;
export type PublishedItemCollection = Collection<PublishedItem>;
