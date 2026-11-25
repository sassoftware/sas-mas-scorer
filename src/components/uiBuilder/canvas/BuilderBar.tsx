// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Button } from '../../common/Button';
import { MenuButton, MenuItem } from '../../common/MenuButton';

interface Props {
  isPreview: boolean;
  onModeChange: (preview: boolean) => void;
  onSave: () => void;
  onSaveAndRun: () => void;
  onShare: () => void;
  onReplaceModule?: () => void;
  onUndo: () => void;
  /** Absent means nothing to undo. */
  undoLabel: string | null;
  isDirty: boolean;
  /** The app has been saved at least once. */
  isSaved: boolean;
  saving: boolean;
}

/** The builder's action bar: save state, Undo, Edit / Preview, more, Save & Run, Save. */
export const BuilderBar: React.FC<Props> = ({
  isPreview,
  onModeChange,
  onSave,
  onSaveAndRun,
  onShare,
  onReplaceModule,
  onUndo,
  undoLabel,
  isDirty,
  isSaved,
  saving,
}) => {
  const status = isDirty ? 'Unsaved changes' : isSaved ? 'All changes saved' : 'Not saved yet';
  const more: MenuItem[] = [
    { id: 'share', label: 'Share…', onSelect: onShare },
    ...(onReplaceModule
      ? [{ id: 'replace', label: 'Replace or re-sync module…', onSelect: onReplaceModule }]
      : []),
  ];
  return (
    <div className="cb-bar">
      <span className={`ui-builder__save-status${isDirty ? ' ui-builder__save-status--dirty' : ''}`} role="status">
        {isDirty && <span className="ui-builder__save-dot" aria-hidden="true" />}
        {status}
      </span>
      <Button
        variant="tertiary"
        size="small"
        onClick={onUndo}
        disabled={!undoLabel}
        title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
        aria-label={undoLabel ? `Undo: ${undoLabel}` : 'Undo'}
        aria-keyshortcuts="Control+Z"
      >
        Undo
      </Button>
      <div className="cb-segmented" role="group" aria-label="Mode">
        <button type="button" aria-pressed={!isPreview} className={!isPreview ? 'cb-segmented__on' : ''} onClick={() => onModeChange(false)}>
          Edit
        </button>
        <button type="button" aria-pressed={isPreview} className={isPreview ? 'cb-segmented__on' : ''} onClick={() => onModeChange(true)}>
          Preview
        </button>
      </div>
      <MenuButton label="More" ariaLabel="More actions" items={more} alignEnd />
      <Button variant="secondary" size="small" onClick={onSaveAndRun} disabled={saving}>
        Save &amp; Run
      </Button>
      <Button variant="primary" size="small" onClick={onSave} loading={saving}>
        Save
      </Button>
    </div>
  );
};
