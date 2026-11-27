// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId, useRef, useState } from 'react';
import { PublishDestination } from '../../types/modelPublish';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import {
  formatDestinationTypeLabel,
  getDestinationDetailFields,
} from '../../utils/publishHelpers';
import { DestinationCounts } from '../../hooks/usePublishingOverview';

interface DestinationsPanelProps {
  destinations: PublishDestination[];
  counts?: Record<string, DestinationCounts>;
  /** Filters the deployed items to one destination (the table below). */
  onShowItems?: (destinationName: string) => void;
}

const pluralize = (n: number, singular: string, plural: string): string =>
  `${n} ${n === 1 ? singular : plural}`;

const NO_COUNTS: DestinationCounts = { models: 0, decisions: 0 };

/**
 * Destinations as a list beside the chosen one's details (Figma 11/13): the
 * list shows each destination's type and what is deployed to it, the panel
 * its settings as labels over values. Up / Down move through the list.
 */
export const DestinationsPanel: React.FC<DestinationsPanelProps> = ({ destinations, counts, onShowItems }) => {
  const id = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  if (destinations.length === 0) {
    return <div className="publishing__none" role="status">No publishing destinations found.</div>;
  }

  // The first destination is shown until one is picked; a picked one that
  // disappeared after a refresh falls back to the first as well.
  const selected = destinations.find((d) => d.id === selectedId) ?? destinations[0];
  const selectedCounts = counts?.[selected.name] ?? NO_COUNTS;
  const details = getDestinationDetailFields(selected);
  const deployed = selectedCounts.models + selectedCounts.decisions;
  const detailId = `${id}-detail`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const index = destinations.findIndex((d) => d.id === selected.id);
    const next =
      e.key === 'Home' ? 0
        : e.key === 'End' ? destinations.length - 1
          : e.key === 'ArrowDown' ? Math.min(destinations.length - 1, index + 1)
            : Math.max(0, index - 1);
    e.preventDefault();
    setSelectedId(destinations[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <div className="sas-card publishing__destinations">
      <ul
        ref={listRef}
        className="publishing__destination-list"
        aria-label="Publishing destinations"
        onKeyDown={handleKeyDown}
      >
        {destinations.map((d) => {
          const c = counts?.[d.name] ?? NO_COUNTS;
          const isSelected = d.id === selected.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                className={`publishing__destination-item${isSelected ? ' publishing__destination-item--selected' : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                aria-controls={detailId}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="publishing__destination-name">{d.name}</span>
                <Badge variant="default" size="small">{formatDestinationTypeLabel(d.destinationType)}</Badge>
                <span className="publishing__destination-counts">
                  {pluralize(c.models, 'model', 'models')} · {pluralize(c.decisions, 'decision', 'decisions')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="publishing__destination-detail" id={detailId} aria-labelledby={`${detailId}-title`}>
        <h3 className="publishing__destination-detail-title" id={`${detailId}-title`}>{selected.name}</h3>
        {selected.description && <p className="publishing__destination-desc">{selected.description}</p>}
        <dl className="publishing__detail-list">
          <div className="publishing__detail-row">
            <dt className="publishing__detail-label">Type</dt>
            <dd className="publishing__detail-value">{formatDestinationTypeLabel(selected.destinationType)}</dd>
          </div>
          <div className="publishing__detail-row">
            <dt className="publishing__detail-label">Deployed</dt>
            <dd className="publishing__detail-value">
              {pluralize(selectedCounts.models, 'model', 'models')}, {pluralize(selectedCounts.decisions, 'decision', 'decisions')}
            </dd>
          </div>
          {details.map((f) => (
            <div key={f.label} className="publishing__detail-row">
              <dt className="publishing__detail-label">{f.label}</dt>
              <dd className="publishing__detail-value">{f.value}</dd>
            </div>
          ))}
        </dl>
        {onShowItems && deployed > 0 && (
          <div className="publishing__destination-actions">
            <Button variant="secondary" size="small" onClick={() => onShowItems(selected.name)}>
              Show its {pluralize(deployed, 'deployed item', 'deployed items')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

export default DestinationsPanel;
