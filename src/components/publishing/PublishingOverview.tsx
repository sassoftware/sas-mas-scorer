// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { PageHeader } from '../layout/Layout';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { useSasAuth } from '../../auth';
import { usePublishingOverview } from '../../hooks/usePublishingOverview';
import { DestinationsPanel } from './DestinationsPanel';
import { PublishedItemsTable } from './PublishedItemsTable';

interface PublishingOverviewProps {
  onNavigateToModule: (moduleId: string) => void;
  onNavigateToFlow: (flowId: string) => void;
}

export const PublishingOverview: React.FC<PublishingOverviewProps> = ({
  onNavigateToModule,
  onNavigateToFlow,
}) => {
  const { isAuthenticated, login, isLoading: authLoading } = useSasAuth();
  const { destinations, dedupedItems, stats, destinationCounts, loading, error, refresh } =
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
          <div className="publishing__stat-value">{stats.destinationCount}</div>
          <div className="publishing__stat-label">Publishing Destinations</div>
        </div>
        <div className="publishing__stat-card publishing__stat-card--models">
          <div className="publishing__stat-value">{stats.modelCount}</div>
          <div className="publishing__stat-label">Models Deployed</div>
        </div>
        <div className="publishing__stat-card publishing__stat-card--decisions">
          <div className="publishing__stat-value">{stats.decisionCount}</div>
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
        <Loading message="Loading publishing data..." />
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
