// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { ExecutionJob } from '../../types/jobExecution';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
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
    // A quiet grey box, as in the Job Monitoring frame (Figma 11/13).
    return (
      <div className="job-monitoring__running-empty" role="status">
        {loading ? <Loading size="small" message="Loading running jobs…" /> : 'No jobs are currently running.'}
      </div>
    );
  }

  return (
    <ul className="job-monitoring__running-grid" aria-label="Running jobs">
      {jobs.map((job) => {
        const name = job.jobRequest.jobDefinition?.name ?? job.jobRequest.name ?? job.id;
        const description = job.jobRequest.description ?? job.jobRequest.jobDefinition?.description;
        const type = job.jobRequest.jobDefinition?.type ?? '—';
        const elapsedMs = elapsedSince(job.creationTimeStamp, now);
        return (
          <li key={job.id} className="sas-card job-monitoring__running-card">
            <div className="job-monitoring__running-head">
              <h3 className="job-monitoring__running-name">{name}</h3>
              <JobStateBadge state={job.state} />
            </div>
            {description && <p className="job-monitoring__running-desc">{description}</p>}
            <dl className="job-monitoring__running-meta">
              <div>
                <dt>Created by</dt>
                <dd>{job.createdBy ?? '—'}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{type}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatTimestamp(job.creationTimeStamp)}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd className="job-monitoring__running-elapsed">{formatDuration(elapsedMs)}</dd>
              </div>
            </dl>
            <div className="job-monitoring__running-actions">
              <Button
                variant="secondary"
                size="small"
                onClick={() => onOpenJob(job.id)}
                aria-label={`Monitor ${name}`}
              >
                Monitor
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
