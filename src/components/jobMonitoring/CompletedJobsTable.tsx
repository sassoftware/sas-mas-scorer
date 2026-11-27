// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { ListColumn, ListTable, ListToolbar } from '../common/ListTable';
import { Pagination } from '../common/Pagination';
import { ExecutionJob } from '../../types/jobExecution';
import { CompletedStateFilter } from '../../hooks/useJobMonitoring';
import { JobStateBadge } from './JobStateBadge';
import { STATE_LABELS, formatDuration, formatTimestamp } from './utils';

interface CompletedJobsTableProps {
  jobs: ExecutionJob[];
  loading: boolean;
  // True when the latest page came back full — i.e., more jobs are available.
  hasMore: boolean;
  page: number;
  pageSize: number;
  search: string;
  stateFilter: CompletedStateFilter;
  onSearchChange: (search: string) => void;
  onStateFilterChange: (state: CompletedStateFilter) => void;
  onPageChange: (page: number) => void;
  onOpenJob: (jobId: string) => void;
}

// 'all' is a filter value, not a job state, so it is the one chip whose label
// does not come from STATE_LABELS.
const STATE_CHIPS: { value: CompletedStateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: STATE_LABELS.completed },
  { value: 'failed', label: STATE_LABELS.failed },
  { value: 'canceled', label: STATE_LABELS.canceled },
  { value: 'timedOut', label: STATE_LABELS.timedOut },
];

export const CompletedJobsTable: React.FC<CompletedJobsTableProps> = ({
  jobs,
  loading,
  hasMore,
  page,
  pageSize,
  search,
  stateFilter,
  onSearchChange,
  onStateFilterChange,
  onPageChange,
  onOpenJob,
}) => {
  // No total to anchor against — Viya's envelope `count` is unreliable on
  // this tenant. We base navigation purely on what the page returned, so the
  // furthest page we can claim exists is the current one, plus one more while
  // the server says there is another. That keeps <Pagination>'s Next enabled
  // exactly while `hasMore`; the honest, open-ended "Showing 1–20+" count
  // lives in the toolbar above the table.
  const rangeStart = jobs.length === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = page * pageSize + jobs.length;
  const showPagination = page > 0 || hasMore;
  // The hook's `page` is 0-based; <Pagination> is 1-based.
  const currentPage = page + 1;
  const knownPages = hasMore ? currentPage + 1 : currentPage;

  // The server pages the history newest first, so columns don't sort (a sort
  // would only reorder the page on screen); they can still be hidden.
  const columns: ListColumn<ExecutionJob>[] = [
    {
      key: 'name',
      label: 'Job',
      render: (job) => {
        const name = job.jobRequest.jobDefinition?.name ?? job.jobRequest.name ?? job.id;
        const description = job.jobRequest.description ?? job.jobRequest.jobDefinition?.description;
        // Inline wrapper: ListTable puts this inside the row's <button>.
        return (
          <span className="job-monitoring__cell-name job-monitoring__cell-name--link">
            <span className="job-monitoring__cell-name-main">{name}</span>
            {description && <span className="job-monitoring__cell-name-sub">{description}</span>}
          </span>
        );
      },
    },
    {
      key: 'state',
      label: 'State',
      width: '110px',
      render: (job) => <JobStateBadge state={job.state} />,
    },
    {
      key: 'createdBy',
      label: 'Created by',
      width: '140px',
      render: (job) => job.createdBy ?? '—',
    },
    {
      key: 'type',
      label: 'Type',
      width: '110px',
      render: (job) => job.jobRequest.jobDefinition?.type ?? '—',
    },
    {
      key: 'started',
      label: 'Started',
      width: '170px',
      render: (job) => <span className="list-nowrap">{formatTimestamp(job.creationTimeStamp)}</span>,
    },
    {
      key: 'elapsed',
      label: 'Elapsed',
      width: '100px',
      align: 'right',
      render: (job) => formatDuration(job.elapsedTime),
    },
  ];

  return (
    <div className="list-page">
      <ListToolbar
        chips={STATE_CHIPS}
        activeChip={stateFilter}
        onChipChange={onStateFilterChange}
        chipsLabel="Filter by state"
        search={{
          value: search,
          onChange: onSearchChange,
          placeholder: 'Search by job name',
          ariaLabel: 'Search completed jobs by name',
        }}
      >
        <span className="job-monitoring__toolbar-count" aria-live="polite">
          {loading
            ? 'Loading…'
            : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}${hasMore ? '+' : ''}`}
        </span>
      </ListToolbar>

      <ListTable<ExecutionJob>
        label="Completed jobs"
        storageKey="jobs"
        columns={columns}
        rows={jobs}
        rowKey={(job) => job.id}
        loading={loading}
        loadingMessage="Loading jobs..."
        onRowClick={(job) => onOpenJob(job.id)}
        emptyMessage={
          search || stateFilter !== 'all'
            ? 'No jobs match the current filter.'
            : 'No completed jobs yet.'
        }
      />

      {showPagination && (
        <Pagination
          className="job-monitoring__pagination"
          label="Completed jobs"
          page={currentPage}
          totalPages={knownPages}
          onPageChange={(next) => onPageChange(next - 1)}
        />
      )}
    </div>
  );
};
