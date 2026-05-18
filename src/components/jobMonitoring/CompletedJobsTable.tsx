// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { DataTable, Column } from '../common/DataTable';
import { Button } from '../common/Button';
import { ExecutionJob } from '../../types/jobExecution';
import { CompletedStateFilter } from '../../hooks/useJobMonitoring';
import { JobStateBadge } from './JobStateBadge';
import { formatDuration, formatTimestamp } from './utils';

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

const STATE_CHIPS: { value: CompletedStateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'timedOut', label: 'Timed Out' },
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
  // this tenant. We base navigation purely on what the page returned.
  const rangeStart = jobs.length === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = page * pageSize + jobs.length;
  const showPagination = page > 0 || hasMore;
  const canPrev = page > 0;
  const canNext = hasMore;

  const columns: Column<ExecutionJob>[] = [
    {
      key: 'name',
      header: 'Job',
      render: (job) => {
        const name = job.jobRequest.jobDefinition?.name ?? job.jobRequest.name ?? job.id;
        const description = job.jobRequest.description ?? job.jobRequest.jobDefinition?.description;
        return (
          <div className="job-monitoring__cell-name job-monitoring__cell-name--link">
            <span className="job-monitoring__cell-name-main">{name}</span>
            {description && <span className="job-monitoring__cell-name-sub">{description}</span>}
          </div>
        );
      },
    },
    {
      key: 'state',
      header: 'State',
      width: '110px',
      render: (job) => <JobStateBadge state={job.state} />,
    },
    {
      key: 'createdBy',
      header: 'Created By',
      width: '140px',
      render: (job) => job.createdBy ?? '—',
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      render: (job) => job.jobRequest.jobDefinition?.type ?? '—',
    },
    {
      key: 'started',
      header: 'Started',
      width: '170px',
      render: (job) => formatTimestamp(job.creationTimeStamp),
    },
    {
      key: 'elapsed',
      header: 'Elapsed',
      width: '100px',
      align: 'right',
      render: (job) => formatDuration(job.elapsedTime),
    },
    {
      key: '_chevron',
      header: '',
      width: '40px',
      align: 'right',
      render: () => (
        <span className="job-monitoring__row-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="job-monitoring__toolbar">
        <div className="job-monitoring__search">
          <input
            type="search"
            className="job-monitoring__search-input"
            placeholder="Search by job name…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search completed jobs by name"
          />
        </div>
        <div className="job-monitoring__chips" role="group" aria-label="Filter by state">
          {STATE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`job-monitoring__chip${stateFilter === chip.value ? ' job-monitoring__chip--active' : ''}`}
              onClick={() => onStateFilterChange(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="job-monitoring__toolbar-spacer" />
        <div className="job-monitoring__toolbar-hint" aria-hidden="true">
          Click a row to view details
        </div>
        <div className="job-monitoring__toolbar-count" aria-live="polite">
          {loading
            ? 'Loading…'
            : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}${hasMore ? '+' : ''}`}
        </div>
      </div>

      <DataTable<ExecutionJob>
        columns={columns}
        data={jobs}
        keyField="id"
        loading={loading && jobs.length === 0}
        onRowClick={(job) => onOpenJob(job.id)}
        emptyMessage={
          search || stateFilter !== 'all'
            ? 'No jobs match the current filter.'
            : 'No completed jobs yet.'
        }
      />

      {showPagination && (
        <div className="job-monitoring__pagination">
          <span className="job-monitoring__pagination-info">
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()}
            {hasMore ? ' (more available)' : ''}
          </span>
          <div className="job-monitoring__pagination-controls">
            <Button
              variant="tertiary"
              size="small"
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={!canPrev}
            >
              Previous
            </Button>
            <span className="job-monitoring__pagination-page">Page {page + 1}</span>
            <Button
              variant="tertiary"
              size="small"
              onClick={() => onPageChange(page + 1)}
              disabled={!canNext}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
