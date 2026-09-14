// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { sasViyaClient } from './client';
import { fetchAllPaginated, paginateCollection } from './paginate';

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

// Every collection here is walked completely: a bare GET would take the
// service default of 10, and a single large page may still be capped.

export const getCasServers = async (): Promise<CasServer[]> => {
  return fetchAllPaginated<CasServer>('/casManagement/servers', {
    headers: { Accept: 'application/json' },
    pageSize: 100,
  });
};

/** All caslibs of a server; `start` is the first offset and `limit` the page size. */
export const getCaslibs = async (
  serverName: string,
  start = 0,
  limit = 500
): Promise<CasLib[]> => {
  return fetchAllPaginated<CasLib>(
    `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs`,
    {
      params: { sortBy: 'name' },
      headers: { Accept: 'application/json' },
      start,
      pageSize: limit,
    }
  );
};

// --- CAS Table Browsing & Row Fetching ---

/**
 * All tables of a caslib from `start` onwards; `limit` is the page size.
 * `count` is the total the service reported, falling back to the number received.
 */
export const getCasTables = async (
  serverName: string,
  caslibName: string,
  start = 0,
  limit = 100
): Promise<{ items: CasTableInfo[]; count: number }> => {
  const result = await paginateCollection<CasTableInfo>(
    `/casManagement/servers/${encodeURIComponent(serverName)}/caslibs/${encodeURIComponent(caslibName)}/tables`,
    {
      params: { sortBy: 'name' },
      headers: { Accept: 'application/json' },
      start,
      pageSize: limit,
    }
  );
  return { items: result.items, count: result.total ?? result.items.length };
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

  const allColumns = await fetchAllPaginated<CasColumnInfo>(
    `/dataTables/dataSources/${dataSourceId}/tables/${tableId}/columns`,
    {
      headers: { Accept: 'application/json' },
      pageSize: 100,
    }
  );

  // Sort by index to guarantee order matches rowSets row data
  return allColumns.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
};

/** One rowSets item: the cell values of a row, in column-index order. */
interface CasRowItem {
  cells: string[];
}

const trimCells = (item: CasRowItem): string[] => item.cells.map((v) => v.trim());

export interface CasTableAllRows {
  /** Every row, cells trimmed, in table order. */
  rows: unknown[][];
  /** Total row count the service reported (0 when it reported none). */
  count: number;
  /** True when the walk stopped at its page cap before the last row. */
  truncated: boolean;
}

export interface CasRowsProgress {
  /** Rows received so far. */
  loaded: number;
  /** Total row count the service reported, or null. */
  total: number | null;
}

// Budget of cells per rowSets request. The rowSets service does not
// guarantee to honour the requested limit, so the chunk is sized from the
// table's measured width rather than guessed: wide tables page in smaller
// row chunks, narrow ones in larger, and the response stays a similar size.
const ROWS_CELL_BUDGET = 250_000;
const ROWS_MIN_CHUNK = 500;
const ROWS_MAX_CHUNK = 10_000;
// 1000 pages × ≥500 rows is well past anything MAS scoring will consume.
const ROWS_MAX_PAGES = 1000;

/**
 * Fetch every row of a CAS table through rowSets, page by page. A one-row
 * probe measures the table width and total, the chunk size follows from it,
 * and the shared walker then honours whatever limit the service actually
 * applies to each page. `onProgress` fires after every page.
 */
export const getAllTableRows = async (
  serverName: string,
  caslibName: string,
  tableName: string,
  onProgress?: (progress: CasRowsProgress) => void
): Promise<CasTableAllRows> => {
  const tableRef = `cas~fs~${encodeURIComponent(serverName)}~fs~${encodeURIComponent(caslibName)}~fs~${encodeURIComponent(tableName)}`;
  const url = `/rowSets/tables/${tableRef}/rows`;

  const probe = await paginateCollection<CasRowItem>(url, {
    headers: { Accept: 'application/json' },
    pageSize: 1,
    maxPages: 1,
    timeout: 120000,
  });
  if (probe.items.length === 0) {
    return { rows: [], count: probe.total ?? 0, truncated: false };
  }

  const width = Math.max(1, probe.items[0].cells.length);
  const chunk = Math.min(
    ROWS_MAX_CHUNK,
    Math.max(ROWS_MIN_CHUNK, Math.floor(ROWS_CELL_BUDGET / width))
  );

  const result = await paginateCollection<CasRowItem>(url, {
    headers: { Accept: 'application/json' },
    pageSize: chunk,
    maxPages: ROWS_MAX_PAGES,
    timeout: 120000,
    onPage: (page) => {
      onProgress?.({ loaded: page.loaded, total: page.total });
    },
  });

  return {
    rows: result.items.map(trimCells),
    count: result.total ?? result.items.length,
    truncated: result.truncated,
  };
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
  const items: CasRowItem[] = response.data.items ?? [];
  const rows = items.map(trimCells);
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
