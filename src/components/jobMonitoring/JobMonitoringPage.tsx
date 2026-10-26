// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useId } from 'react';
import { PageHeader } from '../layout/Layout';
import { Alert } from '../common/Alert';
import { Button } from '../common/Button';
import { useSasAuth } from '../../auth';
import {
  CompletedStateFilter,
  DEFAULT_JOB_STATS_WINDOW,
  JOB_STATS_WINDOWS,
  JobStatsWindow,
  useJobMonitoring,
} from '../../hooks/useJobMonitoring';
import { parsePageParam, useDebouncedUrlText, useListUrlParams } from '../../utils/listUrlState';
import { JobStatsCards } from './JobStatsCards';
import { RunningJobsPanel } from './RunningJobsPanel';
import { CompletedJobsTable } from './CompletedJobsTable';
import { STATS_WINDOW_LABELS } from './utils';
import { useNowTick } from './useNowTick';

interface JobMonitoringPageProps {
  onOpenJob: (jobId: string) => void;
}

// The history's search, state filter and page, and the statistics window,
// live in the URL (#/jobs?q=…&state=failed&page=2&period=30d), so Back from a
// job, a reload or a shared link shows the same view.
const HISTORY_DEFAULTS = { q: '', state: 'all', page: '1', period: DEFAULT_JOB_STATS_WINDOW };

const STATE_FILTERS: readonly CompletedStateFilter[] = ['all', 'completed', 'failed', 'canceled', 'timedOut'];

const toStateFilter = (value: string): CompletedStateFilter =>
  (STATE_FILTERS as readonly string[]).includes(value) ? (value as CompletedStateFilter) : 'all';

const toStatsWindow = (value: string): JobStatsWindow =>
  (JOB_STATS_WINDOWS as readonly string[]).includes(value)
    ? (value as JobStatsWindow)
    : DEFAULT_JOB_STATS_WINDOW;

// "14 Oct, 09:30" — how far back a running stats walk has got.
const formatReached = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const JobMonitoringPage: React.FC<JobMonitoringPageProps> = ({ onOpenJob }) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();

  const [params, updateParams] = useListUrlParams('jobs', HISTORY_DEFAULTS);
  const stateFilter = toStateFilter(params.state);
  // 0-based for the hook and the table; the URL holds the 1-based number.
  const page = parsePageParam(params.page) - 1;
  // The box follows typing at once; the query (and the URL) after a pause.
  // A new search starts from the first page.
  const commitSearch = useCallback(
    (q: string) => updateParams({ q, page: HISTORY_DEFAULTS.page }),
    [updateParams]
  );
  const [searchText, setSearchText] = useDebouncedUrlText(params.q, commitSearch);
  const setStateFilter = (next: CompletedStateFilter) =>
    updateParams({ state: next, page: HISTORY_DEFAULTS.page });
  const setPage = (next: number) => updateParams({ page: String(next + 1) });
  const statsWindow = toStatsWindow(params.period);
  const periodLabelId = useId();
  const setStatsWindow = (next: JobStatsWindow) => updateParams({ period: next });

  const monitor = useJobMonitoring({
    enabled: isAuthenticated,
    search: params.q,
    stateFilter,
    page,
    statsWindow,
  });

  // Seconds until the next automatic retry, for the recovery banner.
  const now = useNowTick(1000, monitor.pollingRetryAt !== null);
  const retryInSec =
    monitor.pollingRetryAt === null
      ? 0
      : Math.max(0, Math.ceil((monitor.pollingRetryAt - now) / 1000));

  if (!isAuthenticated && !authLoading) {
    return (
      <div className="job-monitoring">
        <PageHeader
          title="Job Monitoring"
          subtitle="Please log in to view job execution data"
        />
        <div className="job-monitoring__login-prompt">
          <Button variant="primary" onClick={login}>
            Log In to SAS Viya
          </Button>
        </div>
      </div>
    );
  }

  const runningCount =
    monitor.stats?.counts.active !== null && monitor.stats?.counts.active !== undefined
      ? monitor.stats.counts.active
      : monitor.runningJobs.length;

  return (
    <div className="job-monitoring">
      <PageHeader
        title="Job Monitoring"
        subtitle="Track running jobs in real time and review historical executions"
        actions={
          <Button variant="secondary" onClick={monitor.refresh} loading={monitor.refreshing}>
            Refresh
          </Button>
        }
      />

      <div className="job-monitoring__stats-bar">
        <div
          className="job-monitoring__chips"
          role="group"
          aria-labelledby={periodLabelId}
        >
          <span className="job-monitoring__chips-label" id={periodLabelId}>
            Statistics for
          </span>
          {JOB_STATS_WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={statsWindow === value}
              className={`job-monitoring__chip${statsWindow === value ? ' job-monitoring__chip--active' : ''}`}
              onClick={() => setStatsWindow(value)}
            >
              {STATS_WINDOW_LABELS[value].chip}
            </button>
          ))}
        </div>
        {monitor.statsScanning && (
          <div
            className="job-monitoring__scanning"
            role="status"
            aria-live="polite"
          >
            <span className="sas-spinner sas-spinner--small" aria-hidden="true" />
            <span>
              Counting jobs
              {statsWindow === 'all' ? '' : ` ${STATS_WINDOW_LABELS[statsWindow].phrase}`}…
              {monitor.stats && monitor.stats.window === statsWindow && monitor.stats.scanned > 0
                ? ` ${monitor.stats.scanned.toLocaleString()} so far`
                : ''}
              {monitor.statsReachedMs !== null
                ? `, back to ${formatReached(monitor.statsReachedMs)}`
                : ''}
            </span>
          </div>
        )}
      </div>

      <JobStatsCards
        stats={monitor.stats}
        loading={monitor.statsLoading}
        window={statsWindow}
      />

      {monitor.pollingRetryAt !== null && (
        <Alert
          variant="warning"
          actions={
            <Button variant="tertiary" size="small" onClick={monitor.refresh}>
              Retry now
            </Button>
          }
        >
          Some data could not be refreshed from SAS Viya. Retrying automatically
          {/* The countdown ticks every second; it is hidden from screen
              readers so the alert is not re-read each tick. */}
          <span aria-hidden="true">
            {retryInSec > 0 ? ` in ${retryInSec} s` : ' now'}
          </span>
          .
          {monitor.pollingError ? ` Last error: ${monitor.pollingError}` : ''}
        </Alert>
      )}

      <section className="job-monitoring__section" aria-label="Currently running jobs">
        <div className="job-monitoring__section-header">
          {/* The live count sits beside the heading, not inside it, so the
              heading's accessible name is stable across polls. */}
          <div className="job-monitoring__section-title-group">
            <h2 className="job-monitoring__section-title">Running</h2>
            <span className="job-monitoring__section-meta">
              {monitor.runningLoading && monitor.runningJobs.length === 0
                ? 'Loading…'
                : `${runningCount} active`}
            </span>
          </div>
          <span className="job-monitoring__section-meta">Auto-refreshes every 5 s</span>
        </div>
        <RunningJobsPanel
          jobs={monitor.runningJobs}
          loading={monitor.runningLoading}
          onOpenJob={onOpenJob}
        />
      </section>

      <section className="job-monitoring__section" aria-label="Completed jobs history">
        <div className="job-monitoring__section-header">
          <h2 className="job-monitoring__section-title">History</h2>
          <span className="job-monitoring__section-meta">
            {params.q === '' && stateFilter === 'all' && page === 0
              ? 'Auto-refreshes every 30 s'
              : 'Auto-refresh paused while filtering'}
          </span>
        </div>
        {monitor.completedError && (
          <Alert
            variant="error"
            actions={
              <Button variant="tertiary" size="small" onClick={monitor.refresh}>
                Retry
              </Button>
            }
          >
            {monitor.completedError}
          </Alert>
        )}
        <CompletedJobsTable
          jobs={monitor.completedJobs}
          loading={monitor.completedLoading}
          hasMore={monitor.completedHasMore}
          page={page}
          pageSize={monitor.pageSize}
          search={searchText}
          stateFilter={stateFilter}
          onSearchChange={setSearchText}
          onStateFilterChange={setStateFilter}
          onPageChange={setPage}
          onOpenJob={onOpenJob}
        />
      </section>
    </div>
  );
};

export default JobMonitoringPage;
