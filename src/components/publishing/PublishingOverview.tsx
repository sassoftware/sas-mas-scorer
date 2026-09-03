// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
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
    <div className="publishing__progress" role="status" aria-live="polite">
      <div className="publishing__progress-header">
        <span className="publishing__progress-phase">Loading publishing data</span>
        <span className="publishing__progress-count">
          {progress.itemsLoaded > 0 ? `${progress.itemsLoaded} loaded` : ''}
        </span>
      </div>
      <div className="publishing__progress-track">
        <div className="publishing__progress-fill" />
      </div>
      <div className="publishing__progress-message">{message}</div>
      <div className="publishing__progress-steps">
        <span className={progress.destinationsComplete ? 'publishing__progress-step--done' : undefined}>
          {progress.destinationsComplete
            ? `✓ Destinations (${progress.destinationsLoaded})`
            : 'Destinations…'}
        </span>
        <span className={progress.itemsComplete ? 'publishing__progress-step--done' : undefined}>
          {progress.itemsComplete
            ? `✓ Deployed models & decisions (${progress.itemsLoaded})`
            : `Deployed models & decisions${progress.itemsLoaded > 0 ? ` (${progress.itemsLoaded})` : ''}…`}
        </span>
      </div>
    </div>
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
  const { destinations, dedupedItems, stats, destinationCounts, loading, progress, error, refresh } =
    usePublishingOverview({ enabled: isAuthenticated });

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
          <Button variant="secondary" onClick={refresh} loading={loading}>
            Refresh
          </Button>
        }
      />

      <section className="publishing__stats" aria-label="Summary statistics">
        <div className="publishing__stat-card publishing__stat-card--destinations">
          <div className="publishing__stat-value">{loading ? '—' : stats.destinationCount}</div>
          <div className="publishing__stat-label">Publishing Destinations</div>
        </div>
        <div className="publishing__stat-card publishing__stat-card--models">
          <div className="publishing__stat-value">{loading ? '—' : stats.modelCount}</div>
          <div className="publishing__stat-label">Models Deployed</div>
        </div>
        <div className="publishing__stat-card publishing__stat-card--decisions">
          <div className="publishing__stat-value">{loading ? '—' : stats.decisionCount}</div>
          <div className="publishing__stat-label">Decisions Deployed</div>
        </div>
      </section>

      {error && (
        <div className="publishing__error">
          <span>{error}</span>
          <Button variant="tertiary" size="small" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <LoadingProgress progress={progress} />
      ) : (
        <>
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
