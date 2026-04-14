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

// --- CAS Table Browsing & Row Fetching ---

export const getCasTables = async (
  serverName: string,
  caslibName: string,
  start = 0,
  limit = 100
): Promise<{ items: CasTableInfo[]; count: number }> => {
  const response = await sasViyaClient.get(
    `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs/${encodeURIComponent(caslibName)}/tables`,
    {
      params: { start, limit, sortBy: 'name' },
      headers: { Accept: 'application/json' },
    }
  );
  return { items: response.data.items ?? [], count: response.data.count ?? 0 };
};

export interface CasColumnInfo {
  name: string;
  index?: number;
  type: string;
  rawLength?: number;
  formattedLength?: number;
  label?: string;
}

/**
 * Fetch column metadata for a CAS table via the dataTables columns endpoint.
 * Pages through results (default server limit is 10) to get all columns.
 * Returns columns sorted by index to match the row data order from rowSets.
 */
export const getTableColumns = async (
  serverName: string,
  caslibName: string,
  tableName: string
): Promise<CasColumnInfo[]> => {
  const dataSourceId = `cas~fs~${encodeURIComponent(serverName)}~fs~${encodeURIComponent(caslibName)}`;
  const tableId = encodeURIComponent(tableName);
  const allColumns: CasColumnInfo[] = [];
  let start = 0;
  const limit = 100;

  // Page through columns until we have them all
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await sasViyaClient.get(
      `/dataTables/dataSources/${dataSourceId}/tables/${tableId}/columns`,
      {
        params: { start, limit },
        headers: { Accept: 'application/json' },
      }
    );
    const items: CasColumnInfo[] = response.data.items ?? [];
    allColumns.push(...items);

    const total = response.data.count ?? items.length;
    if (allColumns.length >= total || items.length === 0) {
      break;
    }
    start += items.length;
  }

  // Sort by index to guarantee order matches rowSets row data
  return allColumns.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
};

export interface CasTableRowsResponse {
  rows: unknown[][];
  count: number;
  start: number;
  limit: number;
}

export const getTableRows = async (
  serverName: string,
  caslibName: string,
  tableName: string,
  start = 0,
  limit = 1000
): Promise<CasTableRowsResponse> => {
  const tableRef = `cas~fs~${encodeURIComponent(serverName)}~fs~${encodeURIComponent(caslibName)}~fs~${encodeURIComponent(tableName)}`;
  const response = await sasViyaClient.get(
    `/rowSets/tables/${tableRef}/rows`,
    {
      params: { start, limit },
      headers: { Accept: 'application/json' },
      timeout: 120000,
    }
  );
  // Response is { items: [{ cells: [val, val, ...] }, ...], count, start, limit }
  const items: { cells: string[] }[] = response.data.items ?? [];
  const rows = items.map(item => item.cells.map((v: string) => v.trim()));
  return {
    rows,
    count: response.data.count ?? 0,
    start: response.data.start ?? start,
    limit: response.data.limit ?? limit,
  };
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
