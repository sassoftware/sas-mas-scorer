// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Loading } from './Loading';
import { EmptyState } from './EmptyState';

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
  /**
   * Makes rows navigable. The whole row reacts to the mouse, and the first
   * column's content is wrapped in a real <button> so keyboard users can
   * reach the same action — so the first column must not render its own
   * interactive elements (links, buttons) when this is set.
   */
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
    return <Loading size="small" message="Loading data..." />;
  }

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} />;
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

            const rowClasses = [
              'sas-table__row',
              onRowClick ? 'sas-table__row--clickable' : '',
              isSelected ? 'sas-table__row--selected' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr
                key={key}
                className={rowClasses}
                onClick={() => onRowClick?.(item)}
              >
                {columns.map((column, columnIndex) => {
                  const content = column.render
                    ? column.render(item, rowIndex)
                    : String((item as Record<string, unknown>)[column.key] ?? '');

                  return (
                    <td
                      key={`${key}-${column.key}`}
                      className="sas-table__td"
                      style={{ textAlign: column.align ?? 'left' }}
                    >
                      {onRowClick && columnIndex === 0 ? (
                        <button
                          type="button"
                          className="sas-table__row-button"
                          onClick={(e) => {
                            e.stopPropagation(); // the <tr> handler would fire a second time
                            onRowClick(item);
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
