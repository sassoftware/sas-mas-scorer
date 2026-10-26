// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { JobMonitoringStats, JobStatsWindow } from '../../hooks/useJobMonitoring';
import { STATS_WINDOW_LABELS, formatDuration } from './utils';

interface JobStatsCardsProps {
  stats: JobMonitoringStats | null;
  loading: boolean;
  // The window the figures cover (Active is always "now").
  window: JobStatsWindow;
}

// Renders a number when known. While the walk is in progress, partial values
// keep updating — only show "—" when we have literally nothing yet.
const Stat: React.FC<{ value: number | null; suffix?: string }> = ({ value, suffix }) => (
  <div className="sas-stat-value">
    {value === null ? '—' : `${value.toLocaleString()}${suffix ?? ''}`}
  </div>
);

// Shared KPI tile (.sas-card + .sas-stat-card). This page contributes only
// the accent modifier that colours each tile's left border.
const CARD = 'sas-card sas-stat-card';

export const JobStatsCards: React.FC<JobStatsCardsProps> = ({ stats, window: statsWindow }) => {
  // Figures from another window (the moment after a switch) are not shown.
  const current = stats && stats.window === statsWindow ? stats : null;
  const counts = current?.counts;
  const active = stats?.counts.active ?? null;
  const avg = current?.averageRuntime;
  const truncatedSuffix = current?.truncated ? '+' : '';
  const phrase = STATS_WINDOW_LABELS[statsWindow].phrase;

  return (
    <section className="job-monitoring__stats" aria-label={`Job summary statistics, ${phrase}`}>
      <div className={`${CARD} job-monitoring__stat-card--total`}>
        <Stat value={counts?.total ?? null} suffix={truncatedSuffix} />
        <div className="sas-stat-label">Total Jobs</div>
        <div className="job-monitoring__stat-sub">
          {current?.truncated ? `most recent, ${phrase}` : phrase}
        </div>
      </div>
      <div className={`${CARD} job-monitoring__stat-card--running`}>
        <Stat value={active} />
        <div className="sas-stat-label">Active</div>
        <div className="job-monitoring__stat-sub">running &amp; pending now</div>
      </div>
      <div className={`${CARD} job-monitoring__stat-card--completed`}>
        <Stat value={counts?.completed ?? null} />
        <div className="sas-stat-label">Completed</div>
        <div className="job-monitoring__stat-sub">{phrase}</div>
      </div>
      <div className={`${CARD} job-monitoring__stat-card--failed`}>
        <Stat
          value={
            counts && counts.failed !== null && counts.other !== null
              ? counts.failed + counts.other
              : counts?.failed ?? null
          }
        />
        <div className="sas-stat-label">Failed / Other</div>
        <div className="job-monitoring__stat-sub">
          {counts && counts.failed !== null && counts.other !== null
            ? `${counts.failed} failed · ${counts.other} canceled/other`
            : counts && counts.failed !== null
              ? `${counts.failed} failed`
              : ' '}
        </div>
      </div>
      <div className={`${CARD} job-monitoring__stat-card--runtime`}>
        <div className="sas-stat-value">
          {avg && avg.sampleSize > 0 ? formatDuration(avg.averageMs) : '—'}
        </div>
        <div className="sas-stat-label">Avg Runtime</div>
        <div className="job-monitoring__stat-sub">
          {avg && avg.sampleSize > 0 ? `over ${avg.sampleSize} completed` : ' '}
        </div>
      </div>
    </section>
  );
};
