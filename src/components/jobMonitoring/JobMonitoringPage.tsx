// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { useSasAuth } from '../../auth';
import { useJobMonitoring } from '../../hooks/useJobMonitoring';
import { JobStatsCards } from './JobStatsCards';
import { RunningJobsPanel } from './RunningJobsPanel';
import { CompletedJobsTable } from './CompletedJobsTable';

interface JobMonitoringPageProps {
  onOpenJob: (jobId: string) => void;
}

export const JobMonitoringPage: React.FC<JobMonitoringPageProps> = ({ onOpenJob }) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();
  const monitor = useJobMonitoring({ enabled: isAuthenticated });

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

      {monitor.statsScanning && (
        <div
          className="job-monitoring__scanning"
          role="status"
          aria-live="polite"
        >
          <span className="job-monitoring__scanning-spinner" />
          <span>
            Loading jobs…
            {monitor.stats && monitor.stats.scanned > 0
              ? ` ${monitor.stats.scanned.toLocaleString()} so far`
              : ''}
          </span>
        </div>
      )}

      <JobStatsCards stats={monitor.stats} loading={monitor.statsLoading} />


      {monitor.pollingPaused && (
        <div className="job-monitoring__error">
          <span>
            Auto-refresh paused due to errors from SAS Viya.
            {monitor.statsError || monitor.runningError || monitor.completedError
              ? ` Last error: ${monitor.statsError ?? monitor.runningError ?? monitor.completedError}`
              : ''}
          </span>
          <Button variant="tertiary" size="small" onClick={monitor.refresh}>
            Retry
          </Button>
        </div>
      )}

      <section className="job-monitoring__section" aria-label="Currently running jobs">
        <div className="job-monitoring__section-header">
          <h2 className="job-monitoring__section-title">
            Running
            <span className="job-monitoring__section-meta">
              {monitor.runningLoading && monitor.runningJobs.length === 0
                ? 'Loading…'
                : `${runningCount} active`}
            </span>
          </h2>
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
            {monitor.search === '' && monitor.stateFilter === 'all' && monitor.page === 0
              ? 'Auto-refreshes every 30 s'
              : 'Auto-refresh paused while filtering'}
          </span>
        </div>
        {monitor.completedError && (
          <div className="job-monitoring__error">
            <span>{monitor.completedError}</span>
            <Button variant="tertiary" size="small" onClick={monitor.refresh}>
              Retry
            </Button>
          </div>
        )}
        <CompletedJobsTable
          jobs={monitor.completedJobs}
          loading={monitor.completedLoading}
          hasMore={monitor.completedHasMore}
          page={monitor.page}
          pageSize={monitor.pageSize}
          search={monitor.search}
          stateFilter={monitor.stateFilter}
          onSearchChange={monitor.setSearch}
          onStateFilterChange={monitor.setStateFilter}
          onPageChange={monitor.setPage}
          onOpenJob={onOpenJob}
        />
      </section>
    </div>
  );
};

export default JobMonitoringPage;
