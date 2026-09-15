// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId } from 'react';
import { Button } from './Button';

export interface PaginationProps {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages; values below 1 are treated as one page. */
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Rows per page — needed for the "Showing a-b of n" summary and the select. */
  pageSize?: number;
  /** Total rows across all pages; shows the "Showing a-b of n" summary. */
  totalItems?: number;
  /** Offer a page-size select with these options. Requires onPageSizeChange. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** Visible text of the page-size label. */
  pageSizeLabel?: string;
  /** Disables every control (e.g. while a page is loading). */
  disabled?: boolean;
  /** Accessible name of the <nav>; default "Pagination". */
  label?: string;
  className?: string;
}

/**
 * Previous / "Page X of Y" / Next, with an optional range summary and
 * page-size select. The status text is a polite live region, so paging with
 * the keyboard is announced without moving focus.
 */
export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  pageSize,
  totalItems,
  pageSizeOptions,
  onPageSizeChange,
  pageSizeLabel = 'Rows per page',
  disabled = false,
  label = 'Pagination',
  className = '',
}) => {
  const generatedId = useId();
  const selectId = `sas-pagination-size-${generatedId}`;

  const lastPage = Math.max(1, totalPages);
  const currentPage = Math.min(Math.max(1, page), lastPage);
  const atStart = currentPage <= 1;
  const atEnd = currentPage >= lastPage;
  const showSizeSelect =
    pageSizeOptions !== undefined && pageSizeOptions.length > 0 && onPageSizeChange !== undefined;
  // The select is controlled; without a pageSize it falls back to the first
  // option so React never sees an uncontrolled -> controlled switch.
  const selectedSize = pageSize ?? pageSizeOptions?.[0] ?? '';

  let range: string | null = null;
  if (totalItems !== undefined && pageSize !== undefined && pageSize > 0) {
    if (totalItems === 0) {
      range = 'No results';
    } else {
      const first = (currentPage - 1) * pageSize + 1;
      const last = Math.min(currentPage * pageSize, totalItems);
      range = `Showing ${first}-${last} of ${totalItems}`;
    }
  }

  const classes = ['sas-pagination', className].filter(Boolean).join(' ');

  return (
    <nav className={classes} aria-label={label}>
      {range && <span className="sas-pagination__range">{range}</span>}
      <div className="sas-pagination__controls">
        {/* At the ends of the range the buttons are aria-disabled, not
            disabled: paging with the keyboard must not pull focus out from
            under the user and drop it on <body>. */}
        <Button
          variant="secondary"
          size="small"
          disabled={disabled}
          aria-disabled={atStart || undefined}
          onClick={() => {
            if (!atStart) onPageChange(currentPage - 1);
          }}
        >
          Previous
        </Button>
        <span className="sas-pagination__status" aria-live="polite">
          Page {currentPage} of {lastPage}
        </span>
        <Button
          variant="secondary"
          size="small"
          disabled={disabled}
          aria-disabled={atEnd || undefined}
          onClick={() => {
            if (!atEnd) onPageChange(currentPage + 1);
          }}
        >
          Next
        </Button>
      </div>
      {showSizeSelect && (
        <span className="sas-pagination__size">
          <label htmlFor={selectId}>{pageSizeLabel}</label>
          <select
            id={selectId}
            className="sas-pagination__size-select"
            value={selectedSize}
            disabled={disabled}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          >
            {pageSizeOptions?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </span>
      )}
    </nav>
  );
};

export default Pagination;
