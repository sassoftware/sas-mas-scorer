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
  /** Save and stay in the builder. */
  onSave: () => void;
  /** Save, then open the app in the runner. */
  onSaveAndRun: () => void;
  onPreview: () => void;
  onShare: () => void;
  onReplaceModule?: () => void;
  /** Undo the last edit; absent label means nothing to undo. */
  onUndo: () => void;
  undoLabel: string | null;
  /** The definition differs from the last saved one. */
  isDirty: boolean;
  /** The app has been saved at least once (a new app has not). */
  isSaved: boolean;
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
  onSaveAndRun,
  onPreview,
  onShare,
  onReplaceModule,
  onUndo,
  undoLabel,
  isDirty,
  isSaved,
  saving,
  isPreview,
}) => {
  const status = isDirty
    ? 'Unsaved changes'
    : isSaved ? 'All changes saved' : 'Not saved yet';
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
            aria-label="UI App name"
          />
          <input
            type="text"
            className="sas-input ui-builder__desc-input"
            value={definition.description ?? ''}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Description (optional)"
            aria-label="Description"
          />
        </div>
      </div>
      <div className="ui-builder__toolbar-center">
        <div className="ui-builder__option-group">
          <label className="ui-builder__option-label">Columns:</label>
          {[1, 2, 3].map(n => (
            <button
              key={n}
              type="button"
              className={`ui-builder__col-btn ${definition.layout.columns === n ? 'ui-builder__col-btn--active' : ''}`}
              aria-pressed={definition.layout.columns === n}
              aria-label={`${n} column${n === 1 ? '' : 's'}`}
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
        <span
          className={`ui-builder__save-status${isDirty ? ' ui-builder__save-status--dirty' : ''}`}
          role="status"
        >
          {isDirty && <span className="ui-builder__save-dot" aria-hidden="true" />}
          {status}
        </span>
        <Button
          variant="tertiary"
          onClick={onUndo}
          disabled={!undoLabel}
          title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Undo'}
          aria-keyshortcuts="Control+Z"
        >
          Undo
        </Button>
        <Button variant="tertiary" onClick={onShare}>
          Share
        </Button>
        {onReplaceModule && (
          <Button variant="tertiary" onClick={onReplaceModule}>
            Replace / Re-sync Module
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={onPreview}
          aria-pressed={isPreview}
        >
          {isPreview ? 'Back to Editing' : 'Preview & Test Run'}
        </Button>
        <Button variant="secondary" onClick={onSaveAndRun} disabled={saving}>
          Save &amp; Run
        </Button>
        <Button variant="primary" onClick={onSave} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
};
