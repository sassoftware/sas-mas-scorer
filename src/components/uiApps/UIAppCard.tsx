// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinitionSummary } from '../../types/uiBuilder';
import { Card, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { MenuButton } from '../common/MenuButton';

interface Props {
  app: UIDefinitionSummary;
  onRun: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}

export const UIAppCard: React.FC<Props> = ({ app, onRun, onEdit, onDuplicate, onExport, onDelete }) => {
  return (
    <Card className="ui-app-card">
      <CardBody>
        <div className="ui-app-card__header">
          <h3 className="ui-app-card__name">{app.name}</h3>
          <span className="ui-app-card__badges">
            <Badge variant={app.scrUrl ? 'warning' : 'info'} size="small">{app.scrUrl ? 'SCR' : 'MAS'}</Badge>
            <Badge variant="default" size="small">{app.stepId}</Badge>
          </span>
        </div>
        {app.description && (
          <p className="ui-app-card__description">{app.description}</p>
        )}
        <div className="ui-app-card__meta">
          <span className="ui-app-card__module" title={app.scrUrl}>
            {app.scrUrl ? 'SCR endpoint' : 'MAS module'}: {app.moduleId}
          </span>
          <span className="ui-app-card__date">
            Updated: {new Date(app.updatedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="ui-app-card__actions">
          <Button variant="primary" size="small" onClick={() => onRun(app.id)}>Run</Button>
          <Button variant="secondary" size="small" onClick={() => onEdit(app.id)}>Edit</Button>
          <MenuButton
            label={<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>}
            ariaLabel={`More actions for ${app.name}`}
            triggerClassName="ui-app-card__more"
            hideChevron
            alignEnd
            floating
            items={[
              { id: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicate(app.id) },
              { id: 'export', label: 'Export', onSelect: () => onExport(app.id) },
              { id: 'delete', label: 'Delete', onSelect: () => onDelete(app.id) },
            ]}
          />
        </div>
      </CardBody>
    </Card>
  );
};
