// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (item: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  onRowClick?: (item: T) => void;
  selectedKey?: string | number;
  loading?: boolean;
  emptyMessage?: string;
  striped?: boolean;
  hoverable?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  onRowClick,
  selectedKey,
  loading = false,
  emptyMessage = 'No data available',
  striped = true,
  hoverable = true,
}: DataTableProps<T>) {
  const tableClasses = [
    'sas-table',
    striped ? 'sas-table--striped' : '',
    hoverable ? 'sas-table--hoverable' : '',
    onRowClick ? 'sas-table--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (loading) {
    return (
      <div className="sas-table__loading">
        <div className="sas-table__loading-spinner" />
        <span>Loading data...</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="sas-table__empty">
        <svg
          className="sas-table__empty-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="sas-table__wrapper">
      <table className={tableClasses}>
        <thead className="sas-table__head">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className="sas-table__th"
                style={{
                  width: column.width,
                  textAlign: column.align ?? 'left',
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="sas-table__body">
          {data.map((item, rowIndex) => {
            const key = String(item[keyField]);
            const isSelected = selectedKey !== undefined && selectedKey === key;

            return (
              <tr
                key={key}
                className={`sas-table__row ${isSelected ? 'sas-table__row--selected' : ''}`}
                onClick={() => onRowClick?.(item)}
              >
                {columns.map((column) => (
                  <td
                    key={`${key}-${column.key}`}
                    className="sas-table__td"
                    style={{ textAlign: column.align ?? 'left' }}
                  >
                    {column.render
                      ? column.render(item, rowIndex)
                      : String((item as Record<string, unknown>)[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
