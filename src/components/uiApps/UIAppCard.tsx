// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinitionSummary } from '../../types/uiBuilder';
import { Card, CardBody } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

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
          <Badge variant="info">{app.stepId}</Badge>
        </div>
        {app.description && (
          <p className="ui-app-card__description">{app.description}</p>
        )}
        <div className="ui-app-card__meta">
          <span className="ui-app-card__module">Module: {app.moduleId}</span>
          <span className="ui-app-card__date">
            Updated: {new Date(app.updatedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="ui-app-card__actions">
          <Button variant="primary" size="small" onClick={() => onRun(app.id)}>Run</Button>
          <Button variant="secondary" size="small" onClick={() => onEdit(app.id)}>Edit</Button>
          <Button variant="tertiary" size="small" onClick={() => onDuplicate(app.id)}>Duplicate</Button>
          <Button variant="tertiary" size="small" onClick={() => onExport(app.id)}>Export</Button>
          <Button variant="danger" size="small" onClick={() => onDelete(app.id)}>Delete</Button>
        </div>
      </CardBody>
    </Card>
  );
};
