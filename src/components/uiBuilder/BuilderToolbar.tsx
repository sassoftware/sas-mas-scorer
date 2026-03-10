// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinition, UISettings } from '../../types/uiBuilder';
import { Button } from '../common/Button';

interface Props {
  definition: UIDefinition;
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onSettingsChange: (settings: UISettings) => void;
  onColumnsChange: (cols: 1 | 2 | 3) => void;
  onSave: () => void;
  onPreview: () => void;
  saving: boolean;
  isPreview: boolean;
}

export const BuilderToolbar: React.FC<Props> = ({
  definition,
  onNameChange,
  onDescriptionChange,
  onSettingsChange,
  onColumnsChange,
  onSave,
  onPreview,
  saving,
  isPreview,
}) => {
  return (
    <div className="ui-builder__toolbar">
      <div className="ui-builder__toolbar-left">
        <div className="ui-builder__name-group">
          <input
            type="text"
            className="sas-input ui-builder__name-input"
            value={definition.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="UI App Name"
          />
          <input
            type="text"
            className="sas-input ui-builder__desc-input"
            value={definition.description ?? ''}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
      </div>
      <div className="ui-builder__toolbar-center">
        <div className="ui-builder__option-group">
          <label className="ui-builder__option-label">Columns:</label>
          {[1, 2, 3].map(n => (
            <button
              key={n}
              className={`ui-builder__col-btn ${definition.layout.columns === n ? 'ui-builder__col-btn--active' : ''}`}
              onClick={() => onColumnsChange(n as 1 | 2 | 3)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="ui-builder__option-group">
          <label className="ui-builder__option-label">Output:</label>
          <select
            className="sas-input ui-builder__select"
            value={definition.settings.outputLayout || 'below'}
            onChange={(e) => onSettingsChange({
              ...definition.settings,
              outputLayout: e.target.value as UISettings['outputLayout'],
            })}
          >
            <option value="below">Below</option>
            <option value="side-by-side">Side by Side</option>
            <option value="inline">Inline</option>
          </select>
        </div>
        <div className="ui-builder__option-group">
          <label className="ui-builder__option-label">Button:</label>
          <input
            type="text"
            className="sas-input ui-builder__submit-input"
            value={definition.settings.submitLabel ?? 'Execute'}
            onChange={(e) => onSettingsChange({
              ...definition.settings,
              submitLabel: e.target.value,
            })}
            placeholder="Submit label"
          />
        </div>
      </div>
      <div className="ui-builder__toolbar-right">
        <Button
          variant={isPreview ? 'primary' : 'secondary'}
          onClick={onPreview}
        >
          {isPreview ? 'Edit' : 'Preview'}
        </Button>
        <Button variant="primary" onClick={onSave} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
};
