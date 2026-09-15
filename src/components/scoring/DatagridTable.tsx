// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Button } from '../common/Button';
import { parseDatagrid } from '../../utils/datagrid';

interface DatagridTableProps {
  value: unknown[];
  /** Add a modifier class to the scroll wrapper (e.g. inside a modal). */
  wrapperClassName?: string;
}

// Rows rendered before the "show more" control appears, and the step it adds.
// A datagrid can be thousands of rows; rendering them all at once blocks the
// main thread and leaves a very large DOM behind (worst in the jobdef iframe).
const ROW_CHUNK = 200;

const DatagridTableComponent: React.FC<DatagridTableProps> = ({ value, wrapperClassName }) => {
  const { headers, rows } = parseDatagrid(value);
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK);

  // A new grid starts again from the first chunk
  useEffect(() => {
    setVisibleCount(ROW_CHUNK);
  }, [value]);

  const visibleRows = rows.length > visibleCount ? rows.slice(0, visibleCount) : rows;
  const hiddenCount = rows.length - visibleRows.length;

  const wrapperClasses = ['datagrid__wrapper', wrapperClassName].filter(Boolean).join(' ');

  return (
    <div className={wrapperClasses}>
      <table className="datagrid__table">
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
          {visibleRows.map((row, rowIdx) => (
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
      {hiddenCount > 0 && (
        <div className="datagrid__more">
          <span>
            Showing {visibleRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows
          </span>
          <Button
            variant="tertiary"
            size="small"
            onClick={() => setVisibleCount(c => c + ROW_CHUNK)}
          >
            Show {Math.min(ROW_CHUNK, hiddenCount).toLocaleString()} more
          </Button>
          <Button variant="tertiary" size="small" onClick={() => setVisibleCount(rows.length)}>
            Show all
          </Button>
        </div>
      )}
    </div>
  );
};

// Memoised so a parent re-render (e.g. the results view-mode toggle) does not
// rebuild the row elements for an unchanged grid.
export const DatagridTable = React.memo(DatagridTableComponent);

export default DatagridTable;
