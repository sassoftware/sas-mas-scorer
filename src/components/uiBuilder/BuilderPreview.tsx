// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { UIDefinition } from '../../types/uiBuilder';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { DynamicForm } from '../uiRunner/DynamicForm';

interface Props {
  definition: UIDefinition;
}

export const BuilderPreview: React.FC<Props> = ({ definition }) => {
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});

  // Generate mock output values for preview
  const mockOutputs: Record<string, unknown> = {};
  for (const section of definition.layout.sections) {
    for (const field of section.fields) {
      if (field.direction === 'output') {
        if (field.widget === 'gauge') mockOutputs[field.parameterId] = 0.73;
        else if (field.widget === 'badge') mockOutputs[field.parameterId] = 'Approved';
        else mockOutputs[field.parameterId] = 'Sample Value';
      }
    }
  }

  return (
    <div className="ui-builder__preview">
      <div className="ui-builder__preview-banner">
        <Badge variant="warning">Preview Mode</Badge>
        <span>This is a preview of how your UI App will look when running. Output fields show sample data.</span>
      </div>

      <Card>
        <CardHeader
          actions={
            <div className="ui-runner__header-actions">
              {definition.settings.showExecutionTime && (
                <Badge variant="default">142ms</Badge>
              )}
            </div>
          }
        >
          <h3>{definition.settings.title || definition.name}</h3>
        </CardHeader>
        <CardBody>
          <DynamicForm
            layout={definition.layout}
            inputValues={inputValues}
            outputValues={mockOutputs}
            onInputChange={setInputValues}
          />
        </CardBody>
        <CardFooter>
          <Button variant="primary" size="large" disabled>
            {definition.settings.submitLabel || 'Execute'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
