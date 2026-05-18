// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { ExecutionJob } from '../../types/jobExecution';
import { Button } from '../common/Button';
import { JobStateBadge } from './JobStateBadge';
import { elapsedSince, formatDuration, formatTimestamp } from './utils';

interface RunningJobsPanelProps {
  jobs: ExecutionJob[];
  loading: boolean;
  onOpenJob: (jobId: string) => void;
}

// One-second ticker so the elapsed counter updates without any extra API hits.
const useNowTick = (intervalMs: number): number => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
};

export const RunningJobsPanel: React.FC<RunningJobsPanelProps> = ({
  jobs,
  loading,
  onOpenJob,
}) => {
  const now = useNowTick(1000);

  if (jobs.length === 0) {
    return (
      <p className="job-monitoring__empty">
        {loading ? 'Loading running jobs…' : 'No jobs are currently running.'}
      </p>
    );
  }

  return (
    <div className="job-monitoring__running-grid">
      {jobs.map((job) => {
        const name = job.jobRequest.jobDefinition?.name ?? job.jobRequest.name ?? job.id;
        const description = job.jobRequest.description ?? job.jobRequest.jobDefinition?.description;
        const type = job.jobRequest.jobDefinition?.type ?? '—';
        const isPending = job.state === 'pending';
        const elapsedMs = elapsedSince(job.creationTimeStamp, now);
        return (
          <div
            key={job.id}
            className={`job-monitoring__running-card${isPending ? ' job-monitoring__running-card--pending' : ''}`}
          >
            <div className="job-monitoring__running-row">
              <span className="job-monitoring__running-name">{name}</span>
              <JobStateBadge state={job.state} />
            </div>
            {description && <p className="job-monitoring__running-desc">{description}</p>}
            <div className="job-monitoring__running-meta">
              <span><strong>By:</strong> {job.createdBy ?? '—'}</span>
              <span><strong>Type:</strong> {type}</span>
              <span><strong>Started:</strong> {formatTimestamp(job.creationTimeStamp)}</span>
              <span><strong>Elapsed:</strong> {formatDuration(elapsedMs)}</span>
            </div>
            <div className="job-monitoring__running-actions">
              <Button variant="primary" size="small" onClick={() => onOpenJob(job.id)}>
                Monitor
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
