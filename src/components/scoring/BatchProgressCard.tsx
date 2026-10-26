// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Card, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { ProgressBar } from '../common/ProgressBar';
import { BatchProgress, BreakerTrip, formatDuration, formatRate } from './batchRunner';
import { useThrottledAnnouncement } from './useThrottledAnnouncement';

interface BatchProgressCardProps {
  progress: BatchProgress;
  /** A fresh run, or a re-run of the failed rows of the last one */
  phase: 'run' | 'retry';
  /** Set while the circuit breaker holds the run */
  trip: BreakerTrip | null;
  onStop: () => void;
  onContinue: () => void;
}

const MAX_SHOWN_ERROR = 200;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_ERROR ? `${text.slice(0, MAX_SHOWN_ERROR - 1)}…` : text;

/**
 * Live view of a running batch: the bar, succeeded / failed / retried counts,
 * throughput and time left, the last error, and — when the circuit breaker
 * trips — the Continue / Stop question. The figures update with the throttled
 * progress; screen readers get a summary at most every 10 seconds.
 */
export const BatchProgressCard: React.FC<BatchProgressCardProps> = ({
  progress,
  phase,
  trip,
  onStop,
  onContinue,
}) => {
  const { current, total, succeeded, failed, retries, rate, etaMs, lastError } = progress;
  const verb = phase === 'retry' ? 'Retried' : 'Scored';
  const finished = current >= total && total > 0;

  const summary = [
    `${verb} ${current.toLocaleString()} of ${total.toLocaleString()} rows`,
    `${failed.toLocaleString()} failed`,
    etaMs !== null && !finished ? `about ${formatDuration(etaMs)} left` : null,
  ].filter(Boolean).join(', ');
  // The pause has its own alert; the periodic summary stays quiet meanwhile
  const announcement = useThrottledAnnouncement(trip ? '' : `${summary}.`, undefined, finished);

  return (
    <Card className="score-panel__progress-card">
      <CardBody>
        <div className="score-panel__progress">
          <ProgressBar
            value={current}
            max={total}
            label={phase === 'retry' ? 'Retry progress' : 'Batch scoring progress'}
            phase={trip ? 'Paused' : phase === 'retry' ? 'Retrying failed rows' : 'Scoring rows'}
            count={`${current.toLocaleString()} of ${total.toLocaleString()}`}
            className="score-panel__progress-track"
          />

          <dl className="batch-progress__stats">
            <div className="batch-progress__stat">
              <dt>Succeeded</dt>
              <dd>{succeeded.toLocaleString()}</dd>
            </div>
            <div className={`batch-progress__stat${failed > 0 ? ' batch-progress__stat--error' : ''}`}>
              <dt>Failed</dt>
              <dd>{failed.toLocaleString()}</dd>
            </div>
            {retries > 0 && (
              <div className="batch-progress__stat">
                <dt>Automatic retries</dt>
                <dd>{retries.toLocaleString()}</dd>
              </div>
            )}
            <div className="batch-progress__stat">
              <dt>Throughput</dt>
              <dd>{rate !== null ? `${formatRate(rate)} rows/s` : 'measuring…'}</dd>
            </div>
            <div className="batch-progress__stat">
              <dt>Time left</dt>
              <dd>
                {trip ? 'paused' : etaMs !== null ? `about ${formatDuration(etaMs)}` : finished ? 'finishing' : 'estimating…'}
              </dd>
            </div>
          </dl>

          {lastError && !trip && (
            <p className="batch-progress__last-error">
              <span className="batch-progress__last-error-label">Last error:</span> {clip(lastError)}
            </p>
          )}

          {trip && (
            <div className="batch-progress__paused">
              <Alert
                variant="warning"
                title={`Run paused: the last ${trip.streak.toLocaleString()} rows failed`}
                actions={
                  <Button variant="primary" size="small" onClick={onContinue}>
                    Continue
                  </Button>
                }
              >
                <p className="batch-progress__paused-text">
                  Most of them failed with &ldquo;{clip(trip.message)}&rdquo;. This usually means the
                  session expired, the module is gone or the service is down, so no more rows are sent
                  until you choose. <strong>Continue</strong> resumes and stops pausing for this message;{' '}
                  <strong>Stop</strong> ends the run and keeps the rows scored so far.
                </p>
              </Alert>
            </div>
          )}

          {/* One Stop button whether or not the run is paused, so focus on it survives a pause */}
          <Button variant="danger" size="small" onClick={onStop}>
            Stop
          </Button>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      </CardBody>
    </Card>
  );
};

export default BatchProgressCard;
