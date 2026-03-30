// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

// --- Types ---

export interface SasFolder {
  id: string;
  name: string;
  type: string;
  memberCount: number;
  parentFolderUri?: string;
  description?: string;
}

export interface FolderMember {
  id: string;
  name: string;
  contentType: string;
  uri: string;
  type: string;
  parentFolderUri?: string;
  createdBy?: string;
  modifiedTimeStamp?: string;
}

export interface FolderMembersResponse {
  start: number;
  limit: number;
  count: number;
  items: FolderMember[];
}

// --- Folder Browsing APIs ---

export const getRootFolders = async (limit = 100): Promise<SasFolder[]> => {
  const response = await sasViyaClient.get('/folders/rootFolders', {
    params: { limit },
    headers: { Accept: 'application/json' },
  });
  return response.data.items ?? [];
};

export const getFolder = async (folderId: string): Promise<SasFolder> => {
  const response = await sasViyaClient.get(
    `/folders/folders/${encodeURIComponent(folderId)}`,
    {
      headers: { Accept: 'application/json' },
    }
  );
  return response.data;
};

export const getFolderMembers = async (
  folderId: string,
  start = 0,
  limit = 50
): Promise<FolderMembersResponse> => {
  const response = await sasViyaClient.get(
    `/folders/folders/${encodeURIComponent(folderId)}/members`,
    {
      params: {
        start,
        limit,
        sortBy: "eq(contentType,'folder'):descending,name:ascending",
      },
      headers: {
        Accept: 'application/json',
        'Accept-Item': 'application/vnd.sas.content.folder.member.summary+json',
      },
    }
  );
  return response.data;
};
