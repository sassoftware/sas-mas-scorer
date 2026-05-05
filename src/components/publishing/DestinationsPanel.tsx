// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { PublishDestination } from '../../types/modelPublish';
import { Badge } from '../common/Badge';
import { Card, CardBody } from '../common/Card';
import {
  formatDestinationTypeLabel,
  getDestinationDetailFields,
} from '../../utils/publishHelpers';

interface DestinationsPanelProps {
  destinations: PublishDestination[];
}

export const DestinationsPanel: React.FC<DestinationsPanelProps> = ({ destinations }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (destinations.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="publishing__empty">No publishing destinations found.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="publishing__destinations">
      {destinations.map((d) => {
        const isOpen = expanded.has(d.id);
        const details = getDestinationDetailFields(d);
        const hasDetails = details.length > 0;

        return (
          <Card key={d.id} className="publishing__destination-card">
            <div className="publishing__destination-row">
              <div className="publishing__destination-main">
                <div className="publishing__destination-title">
                  <span className="publishing__destination-name">{d.name}</span>
                  <Badge variant="info" size="small">
                    {formatDestinationTypeLabel(d.destinationType)}
                  </Badge>
                </div>
                {d.description && (
                  <p className="publishing__destination-desc">{d.description}</p>
                )}
              </div>
              {hasDetails && (
                <button
                  type="button"
                  className="publishing__destination-toggle"
                  onClick={() => toggle(d.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Hide details' : 'Show details'}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`publishing__chevron ${isOpen ? 'publishing__chevron--open' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
            </div>

            {hasDetails && isOpen && (
              <div className="publishing__destination-details">
                <dl className="publishing__detail-list">
                  {details.map((f) => (
                    <div key={f.label} className="publishing__detail-row">
                      <dt className="publishing__detail-label">{f.label}</dt>
                      <dd className="publishing__detail-value">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default DestinationsPanel;
