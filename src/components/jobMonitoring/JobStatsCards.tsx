// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { JobMonitoringStats } from '../../hooks/useJobMonitoring';
import { formatDuration } from './utils';

interface JobStatsCardsProps {
  stats: JobMonitoringStats | null;
  loading: boolean;
}

// Renders a number when known. While the walk is in progress, partial values
// keep updating — only show "—" when we have literally nothing yet.
const Stat: React.FC<{ value: number | null; suffix?: string }> = ({ value, suffix }) => (
  <div className="job-monitoring__stat-value">
    {value === null ? '—' : `${value.toLocaleString()}${suffix ?? ''}`}
  </div>
);

export const JobStatsCards: React.FC<JobStatsCardsProps> = ({ stats }) => {
  const counts = stats?.counts;
  const avg = stats?.averageRuntime;
  const truncatedSuffix = stats?.truncated ? '+' : '';

  return (
    <section className="job-monitoring__stats" aria-label="Job summary statistics">
      <div className="job-monitoring__stat-card job-monitoring__stat-card--total">
        <Stat value={counts?.total ?? null} suffix={truncatedSuffix} />
        <div className="job-monitoring__stat-label">Total Jobs</div>
      </div>
      <div className="job-monitoring__stat-card job-monitoring__stat-card--running">
        <Stat value={counts?.active ?? null} />
        <div className="job-monitoring__stat-label">Active</div>
        <div className="job-monitoring__stat-sub">running &amp; pending</div>
      </div>
      <div className="job-monitoring__stat-card job-monitoring__stat-card--completed">
        <Stat value={counts?.completed ?? null} />
        <div className="job-monitoring__stat-label">Completed</div>
      </div>
      <div className="job-monitoring__stat-card job-monitoring__stat-card--failed">
        <Stat
          value={
            counts && counts.failed !== null && counts.other !== null
              ? counts.failed + counts.other
              : counts?.failed ?? null
          }
        />
        <div className="job-monitoring__stat-label">Failed / Other</div>
        <div className="job-monitoring__stat-sub">
          {counts && counts.failed !== null && counts.other !== null
            ? `${counts.failed} failed · ${counts.other} cancelled/other`
            : counts && counts.failed !== null
              ? `${counts.failed} failed`
              : ' '}
        </div>
      </div>
      <div className="job-monitoring__stat-card job-monitoring__stat-card--runtime">
        <div className="job-monitoring__stat-value">
          {avg && avg.sampleSize > 0 ? formatDuration(avg.averageMs) : '—'}
        </div>
        <div className="job-monitoring__stat-label">Avg Runtime</div>
        <div className="job-monitoring__stat-sub">
          {avg && avg.sampleSize > 0 ? `over ${avg.sampleSize} completed` : ' '}
        </div>
      </div>
    </section>
  );
};
