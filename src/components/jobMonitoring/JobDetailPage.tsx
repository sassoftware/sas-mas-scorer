// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { useSasAuth } from '../../auth';
import { useJobDetail } from '../../hooks/useJobDetail';
import {
  removeJobFromCache,
  updateJobStateInCache,
} from '../../hooks/useJobMonitoring';
import { cancelJob, deleteJob } from '../../api/jobs';
import { isTerminalState } from '../../types/jobExecution';
import { JobStateBadge } from './JobStateBadge';
import { JobLogViewer } from './JobLogViewer';
import { JobCodePanel } from './JobCodePanel';
import { JobParametersPanel } from './JobParametersPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { elapsedSince, formatDuration, formatTimestamp, sanitizeFilename } from './utils';

type Tab = 'log' | 'listing' | 'code' | 'parameters';

interface JobDetailPageProps {
  jobId: string;
  onBack: () => void;
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'log', label: 'Log' },
  { value: 'listing', label: 'Listing' },
  { value: 'code', label: 'Code' },
  { value: 'parameters', label: 'Parameters' },
];

// Live elapsed ticker — used in the header while the job is running.
const useNowTick = (intervalMs: number, enabled: boolean): number => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs, enabled]);
  return now;
};

export const JobDetailPage: React.FC<JobDetailPageProps> = ({ jobId, onBack }) => {
  const { isAuthenticated } = useSasAuth();
  const detail = useJobDetail(jobId, { enabled: isAuthenticated });
  const [activeTab, setActiveTab] = useState<Tab>('log');

  // Confirmation dialog state for the destructive job actions. `pending`
  // tracks which action is awaiting confirmation; `busy` toggles while
  // the underlying request is in flight; `error` surfaces any failure.
  const [pendingAction, setPendingAction] = useState<'cancel' | 'delete' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const job = detail.job;
  const isTerminal = job ? isTerminalState(job.state) : false;
  const now = useNowTick(1000, !isTerminal && !!job);

  const handleConfirmCancel = async () => {
    if (!job) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await cancelJob(job);
      // Reflect the new state in the monitoring cache so the next time the
      // user lands on /jobs the count breakdown is correct without paying
      // for a full re-walk.
      updateJobStateInCache(job.id, 'canceled');
      setPendingAction(null);
      // Pull the updated job record so the header flips to "canceled" and
      // the Log tab switches over to the saved log file.
      detail.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel the job.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!job) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteJob(job.id);
      removeJobFromCache(job.id);
      setPendingAction(null);
      // Back to the overview — the deleted job is no longer reachable.
      onBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete the job.');
      setActionBusy(false);
    }
  };

  const dismissDialog = () => {
    if (actionBusy) return;
    setPendingAction(null);
    setActionError(null);
  };

  if (detail.jobLoading && !job) {
    return <Loading message="Loading job…" />;
  }

  if (detail.jobError && !job) {
    return (
      <div className="job-detail">
        <button className="job-detail__back" onClick={onBack}>← Back to Job Monitoring</button>
        <div className="job-monitoring__error">
          <span>{detail.jobError}</span>
          <Button variant="tertiary" size="small" onClick={detail.refresh}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="job-detail">
        <button className="job-detail__back" onClick={onBack}>← Back to Job Monitoring</button>
        <p className="job-monitoring__empty">Job not found.</p>
      </div>
    );
  }

  const name = job.jobRequest.jobDefinition?.name ?? job.jobRequest.name ?? job.id;
  const description = job.jobRequest.description ?? job.jobRequest.jobDefinition?.description;
  const type = job.jobRequest.jobDefinition?.type;
  const elapsedMs = isTerminal
    ? job.elapsedTime ?? 0
    : elapsedSince(job.creationTimeStamp, now);

  // Filenames for the Copy/Download actions. The 8-char id suffix
  // disambiguates when multiple jobs share the same name.
  const safeName = sanitizeFilename(name);
  const idSuffix = job.id.slice(0, 8);
  const logFilename = `${safeName}-${idSuffix}.log`;
  const listingFilename = `${safeName}-${idSuffix}.lst`;
  const codeFilename = `${safeName}.sas`;

  const renderPanel = () => {
    switch (activeTab) {
      case 'log':
        return (
          <JobLogViewer
            lines={detail.logLines}
            loading={detail.logLoading}
            error={detail.logError}
            isLive={!isTerminal}
            onRefresh={detail.refresh}
            downloadFilename={logFilename}
          />
        );
      case 'listing':
        return (
          <JobLogViewer
            lines={detail.listingLines}
            loading={detail.listingLoading}
            error={detail.listingError}
            isLive={!isTerminal}
            onRefresh={detail.refresh}
            emptyMessage="No listing output."
            downloadFilename={listingFilename}
          />
        );
      case 'code':
        return (
          <JobCodePanel
            code={job.jobRequest.jobDefinition?.code}
            type={type}
            downloadFilename={codeFilename}
          />
        );
      case 'parameters':
        return (
          <JobParametersPanel
            parameters={job.jobRequest.jobDefinition?.parameters}
            parameterArguments={job.jobRequest.arguments}
          />
        );
    }
  };

  return (
    <div className="job-detail">
      <button className="job-detail__back" onClick={onBack}>← Back to Job Monitoring</button>

      <div className="job-detail__header">
        <div className="job-detail__title-row">
          <h1 className="job-detail__title">{name}</h1>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <JobStateBadge state={job.state} />
            <Button variant="secondary" size="small" onClick={detail.refresh}>
              Refresh
            </Button>
            {isTerminal ? (
              <Button
                variant="danger"
                size="small"
                onClick={() => setPendingAction('delete')}
              >
                Delete Job
              </Button>
            ) : (
              <Button
                variant="danger"
                size="small"
                onClick={() => setPendingAction('cancel')}
              >
                Cancel Job
              </Button>
            )}
          </div>
        </div>
        {description && <p className="job-detail__description">{description}</p>}
        <div className="job-detail__meta">
          <span><strong>By:</strong> {job.createdBy ?? '—'}</span>
          {type && <span><strong>Type:</strong> {type}</span>}
          <span><strong>Started:</strong> {formatTimestamp(job.creationTimeStamp)}</span>
          <span><strong>Elapsed:</strong> {formatDuration(elapsedMs)}</span>
          {job.endTimeStamp && (
            <span><strong>Ended:</strong> {formatTimestamp(job.endTimeStamp)}</span>
          )}
          <span><strong>ID:</strong> {job.id}</span>
        </div>
      </div>

      <div className="job-detail__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={activeTab === tab.value}
            className={`job-detail__tab${activeTab === tab.value ? ' job-detail__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="job-detail__panel" role="tabpanel">
        {renderPanel()}
      </div>

      {pendingAction === 'cancel' && (
        <ConfirmDialog
          title="Cancel this job?"
          message={
            <>
              <p style={{ margin: 0 }}>
                You're about to cancel <strong>{name}</strong>. This will terminate the SAS
                session backing the job (if one is active) and mark the job record as
                <strong> canceled</strong>.
              </p>
              <p style={{ margin: 'var(--space-2) 0 0' }}>
                This cannot be undone.
              </p>
            </>
          }
          confirmLabel="Cancel job"
          cancelLabel="Keep running"
          confirmVariant="danger"
          busy={actionBusy}
          error={actionError}
          onConfirm={handleConfirmCancel}
          onCancel={dismissDialog}
        />
      )}

      {pendingAction === 'delete' && (
        <ConfirmDialog
          title="Delete this job?"
          message={
            <>
              <p style={{ margin: 0 }}>
                You're about to permanently delete <strong>{name}</strong> from SAS Viya. The
                job record, its log, its listing, and any attached result files will be
                removed.
              </p>
              <p style={{ margin: 'var(--space-2) 0 0' }}>
                This cannot be undone.
              </p>
            </>
          }
          confirmLabel="Delete job"
          cancelLabel="Keep job"
          confirmVariant="danger"
          busy={actionBusy}
          error={actionError}
          onConfirm={handleConfirmDelete}
          onCancel={dismissDialog}
        />
      )}
    </div>
  );
};

export default JobDetailPage;
