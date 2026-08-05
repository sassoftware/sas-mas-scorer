// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { parseDatagrid } from '../../utils/datagrid';

interface DatagridTableProps {
  value: unknown[];
}

// Render a MAS datagrid value as a scrollable table
export const DatagridTable: React.FC<DatagridTableProps> = ({ value }) => {
  const { headers, rows } = parseDatagrid(value);

  return (
    <div className="output-display__datagrid-wrapper">
      <table className="output-display__datagrid">
        {headers && (
          <thead>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx}>{header}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {Array.isArray(row) ? (
                row.map((cell, cellIdx) => (
                  <td key={cellIdx}>
                    {cell === null || cell === undefined
                      ? <span className="output-display__null">null</span>
                      : String(cell)}
                  </td>
                ))
              ) : (
                <td>{String(row)}</td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers?.length ?? 1} className="output-display__empty">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DatagridTable;
