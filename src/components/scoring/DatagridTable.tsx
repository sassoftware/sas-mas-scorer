// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Pagination } from '../common/Pagination';
import { parseDatagrid } from '../../utils/datagrid';

interface DatagridTableProps {
  value: unknown[];
  /** Add a modifier class to the scroll wrapper (e.g. inside a modal). */
  wrapperClassName?: string;
}

// Rows rendered per page, and the sizes the user can pick. A datagrid can be
// thousands of rows; rendering them all at once blocks the main thread and
// leaves a very large DOM behind (worst in the jobdef iframe), so only one
// page is committed at a time.
const PAGE_SIZES = [100, 200, 500];
const DEFAULT_PAGE_SIZE = 200;

const DatagridTableComponent: React.FC<DatagridTableProps> = ({ value, wrapperClassName }) => {
  // Memoised on `value` so `rows` is referentially stable across renders —
  // without this the page slice below re-runs (and hands React a brand new
  // array) on every parent render.
  const { headers, rows } = useMemo(() => parseDatagrid(value), [value]);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // 1-based, to match <Pagination>.
  const [page, setPage] = useState(1);

  // A new grid starts again from the first page
  useEffect(() => {
    setPage(1);
  }, [value]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const visibleRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize]
  );

  // Only show the strip when it can do something: more than one page at the
  // current size, or the user has moved off the default size and needs the
  // select to get back (300 rows at 500/page is one page, but hiding the
  // strip there would trap them). A 150-row grid at the default 200 shows no
  // strip at all rather than a misleading "Page 1 of 1".
  const showPagination = pageCount > 1 || pageSize !== DEFAULT_PAGE_SIZE;

  const wrapperClasses = ['datagrid__wrapper', wrapperClassName].filter(Boolean).join(' ');

  return (
    <>
      <div className={wrapperClasses}>
        <table className="sas-table sas-table--compact sas-table--hoverable datagrid__table">
          {headers && (
            <thead className="sas-table__head">
              <tr>
                {headers.map((header, idx) => (
                  <th className="sas-table__th" key={idx}>{header}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {visibleRows.map((row, rowIdx) => (
              <tr className="sas-table__row" key={rowIdx}>
                {Array.isArray(row) ? (
                  row.map((cell, cellIdx) => (
                    <td className="sas-table__td" key={cellIdx}>
                      {cell === null || cell === undefined
                        ? <span className="output-display__null">null</span>
                        : String(cell)}
                    </td>
                  ))
                ) : (
                  <td className="sas-table__td">{String(row)}</td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers?.length ?? 1} className="sas-table__td output-display__empty">
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showPagination && (
        <Pagination
          label="DataGrid rows"
          page={currentPage}
          totalPages={pageCount}
          onPageChange={setPage}
          pageSize={pageSize}
          totalItems={rows.length}
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </>
  );
};

// Memoised so a parent re-render (e.g. the results view-mode toggle) does not
// rebuild the row elements for an unchanged grid.
export const DatagridTable = React.memo(DatagridTableComponent);

export default DatagridTable;
