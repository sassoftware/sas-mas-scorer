// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';

// --- Types ---

export interface CasServer {
  name: string;
  description?: string;
  host?: string;
  port?: number;
  state?: string;
}

export interface CasLib {
  name: string;
  description?: string;
  type?: string;
  path?: string;
  scope?: string;
}

export interface CasTableInfo {
  name: string;
  rowCount?: number;
  columnCount?: number;
  state?: string;
  createdBy?: string;
  modifiedTimeStamp?: string;
}

// --- CAS Management APIs ---

export const getCasServers = async (): Promise<CasServer[]> => {
  const response = await sasViyaClient.get('/casManagement/servers', {
    headers: { Accept: 'application/json' },
  });
  return response.data.items ?? [];
};

export const getCaslibs = async (
  serverName: string,
  start = 0,
  limit = 500
): Promise<CasLib[]> => {
  const response = await sasViyaClient.get(
    `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs`,
    {
      params: { start, limit, sortBy: 'name' },
      headers: { Accept: 'application/json' },
    }
  );
  return response.data.items ?? [];
};

// --- REST Multipart Upload ---

export interface UploadResult {
  success: boolean;
  tableInfo?: CasTableInfo;
  error?: string;
}

export const uploadToCas = async (
  serverName: string,
  caslibName: string,
  tableName: string,
  csvContent: string,
  onProgress?: (status: string) => void
): Promise<UploadResult> => {
  onProgress?.('Uploading via REST API...');

  const formData = new FormData();
  formData.append('tableName', tableName);
  formData.append('format', 'csv');
  formData.append('containsHeaderRow', 'true');
  formData.append('scope', 'global');
  // File must be last field per API docs
  const blob = new Blob([csvContent], { type: 'text/csv' });
  formData.append('file', blob, `${tableName}.csv`);

  try {
    const response = await sasViyaClient.post(
      `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs/${encodeURIComponent(caslibName)}/tables`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          Accept: 'application/json',
        },
        timeout: 120000,
      }
    );
    return { success: true, tableInfo: response.data };
  } catch (err: unknown) {
    const error = err as { response?: { data?: { message?: string } }; message?: string };
    const message = error.response?.data?.message ?? error.message ?? 'Upload failed';
    return { success: false, error: message };
  }
};

// --- Save (persist) a CAS table to its caslib data source ---

export const saveTable = async (
  serverName: string,
  caslibName: string,
  tableName: string
): Promise<void> => {
  await sasViyaClient.post(
    `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs/${encodeURIComponent(caslibName)}/tables/${encodeURIComponent(tableName)}`,
    {
      replace: true,
      format: 'sashdat',
    },
    {
      headers: {
        'Content-Type': 'application/vnd.sas.cas.table.save.request+json',
        Accept: 'application/json',
      },
    }
  );
};
