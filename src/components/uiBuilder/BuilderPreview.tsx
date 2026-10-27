// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinition } from '../../types/uiBuilder';
import { Alert } from '../common/Alert';
import { UIRunner } from '../uiRunner/UIRunner';

interface Props {
  definition: UIDefinition;
  isDirty: boolean;
}

const noop = () => {};

/**
 * The real runner on the unsaved definition: authors see the module's actual
 * outputs in their layout before saving. Runs execute the published module in
 * MAS like any other run; nothing about the app is saved by running it.
 */
export const BuilderPreview: React.FC<Props> = ({ definition, isDirty }) => (
  <div className="ui-builder__preview">
    <Alert variant="info" title="Preview run">
      This runs the published module in MAS with the layout as it is now
      {isDirty ? ', including your unsaved changes' : ''}. Running it does not
      save the app.
    </Alert>
    <UIRunner definition={definition} onBack={noop} onEdit={noop} preview />
  </div>
);
