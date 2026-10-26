// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Card, CardBody } from '../common/Card';
import { ProgressBar } from '../common/ProgressBar';
import { useSasAuth } from '../../auth';
import { usePublishingOverview, PublishingProgress } from '../../hooks/usePublishingOverview';
import { DestinationsPanel } from './DestinationsPanel';
import { PublishedItemsTable } from './PublishedItemsTable';

/**
 * The modelPublish collections do not report a total, so the bar cannot be
 * determinate. The live counts are what tell the user it is advancing.
 */
const LoadingProgress: React.FC<{ progress: PublishingProgress }> = ({ progress }) => {
  const message = !progress.destinationsComplete && progress.itemPages === 0
    ? 'Contacting SAS Viya…'
    : progress.itemsComplete
      ? 'Sorting deployed models and decisions…'
      : `Reading deployed models and decisions… (request ${Math.max(progress.itemPages, 1)})`;

  return (
    <Card>
      <CardBody>
        <div role="status" aria-live="polite">
          <ProgressBar
            indeterminate
            label="Loading publishing data"
            phase="Loading publishing data"
            count={progress.itemsLoaded > 0 ? `${progress.itemsLoaded} loaded` : undefined}
            message={message}
            steps={
              <>
                <span className={progress.destinationsComplete ? 'sas-progress__step--done' : undefined}>
                  {progress.destinationsComplete
                    ? `✓ Destinations (${progress.destinationsLoaded})`
                    : 'Destinations…'}
                </span>
                <span className={progress.itemsComplete ? 'sas-progress__step--done' : undefined}>
                  {progress.itemsComplete
                    ? `✓ Deployed models & decisions (${progress.itemsLoaded})`
                    : `Deployed models & decisions${progress.itemsLoaded > 0 ? ` (${progress.itemsLoaded})` : ''}…`}
                </span>
              </>
            }
          />
        </div>
      </CardBody>
    </Card>
  );
};

// "14:05", or "12 Oct, 14:05" when the data is from an earlier day.
const formatAsOf = (ms: number): string => {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    undefined,
    sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  );
};

interface PublishingOverviewProps {
  onNavigateToModule: (moduleId: string) => void;
  onNavigateToFlow: (flowId: string) => void;
}

export const PublishingOverview: React.FC<PublishingOverviewProps> = ({
  onNavigateToModule,
  onNavigateToFlow,
}) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();
  const {
    destinations,
    dedupedItems,
    stats,
    destinationCounts,
    loading,
    refreshing,
    loadedAt,
    progress,
    error,
    refresh,
  } = usePublishingOverview({ enabled: isAuthenticated });

  // Beside Refresh: how old the (session-cached) data is, or that a refresh
  // is under way. A polite status, so the outcome of Refresh is announced.
  const freshness = refreshing
    ? 'Refreshing…'
    : loadedAt !== null
      ? `Data as of ${formatAsOf(loadedAt)}`
      : '';

  if (!isAuthenticated && !authLoading) {
    return (
      <div className="publishing">
        <PageHeader
          title="Publishing Overview"
          subtitle="Please log in to view publishing information"
        />
        <div className="publishing__login-prompt">
          <Button variant="primary" onClick={login}>
            Log In to SAS Viya
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="publishing">
      <PageHeader
        title="Publishing Overview"
        subtitle="Destinations, deployed models, and deployed decisions across your environment"
        actions={
          <div className="publishing__header-actions">
            <span className="publishing__freshness" role="status" aria-live="polite">
              {freshness}
            </span>
            <Button variant="secondary" onClick={refresh} loading={loading || refreshing}>
              Refresh
            </Button>
          </div>
        }
      />

      <section className="publishing__stats" aria-label="Summary statistics">
        <div className="sas-card sas-stat-card publishing__stat-card--destinations">
          <div className="sas-stat-value">{loading ? '—' : stats.destinationCount}</div>
          <div className="sas-stat-label">Publishing Destinations</div>
        </div>
        <div className="sas-card sas-stat-card publishing__stat-card--models">
          <div className="sas-stat-value">{loading ? '—' : stats.modelCount}</div>
          <div className="sas-stat-label">Models Deployed</div>
        </div>
        <div className="sas-card sas-stat-card publishing__stat-card--decisions">
          <div className="sas-stat-value">{loading ? '—' : stats.decisionCount}</div>
          <div className="sas-stat-label">Decisions Deployed</div>
        </div>
      </section>

      {error && (
        <Alert
          variant="error"
          title={
            loadedAt !== null
              ? 'Failed to refresh publishing overview'
              : 'Failed to load publishing overview'
          }
          actions={
            <Button variant="tertiary" size="small" onClick={refresh}>
              Retry
            </Button>
          }
        >
          {error}
          {loadedAt !== null && ` Still showing the data as of ${formatAsOf(loadedAt)}.`}
        </Alert>
      )}

      {loading ? (
        <LoadingProgress progress={progress} />
      ) : (
        <>
          {/* Kept mounted through a refresh, so the table keeps its search,
              filters and page; the data is swapped in when it arrives. */}
          <section className="publishing__section" aria-label="Publishing destinations">
            <h2 className="publishing__section-title">Destinations</h2>
            <DestinationsPanel destinations={destinations} counts={destinationCounts} />
          </section>

          <section className="publishing__section" aria-label="Published models and decisions">
            <h2 className="publishing__section-title">Deployed Models &amp; Decisions</h2>
            <PublishedItemsTable
              items={dedupedItems}
              onNavigateToModule={onNavigateToModule}
              onNavigateToFlow={onNavigateToFlow}
            />
          </section>
        </>
      )}
    </div>
  );
};

export default PublishingOverview;
