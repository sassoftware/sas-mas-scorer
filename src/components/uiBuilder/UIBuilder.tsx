// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UIDefinition, UISection, UISettings } from '../../types/uiBuilder';
import { Step, Module } from '../../types';
import { PageHeader } from '../layout/Layout';
import { Loading } from '../common/Loading';
import { Alert } from '../common/Alert';
import { Button } from '../common/Button';
import { Modal, isAnyModalOpen } from '../common/Modal';
import { MenuButton } from '../common/MenuButton';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { BuilderPreview } from './BuilderPreview';
import { ReplaceModuleDialog } from './ReplaceModuleDialog';
import { ShareDialog } from './ShareDialog';
import { installLeaveGuard, runWithLeaveGuard } from './leaveGuard';
import { useSteps } from '../../hooks';
import { getModule } from '../../api/modules';
import { saveUIDefinition } from '../../storage/uiStorage';
import {
  computeSignatureDrift,
  createFieldForParameter,
  describeSignatureDrift,
  generateDefaultUI,
  hasSignatureDrift,
} from '../../utils/uiDefaults';
import { getScoreableStep } from '../../utils/moduleHelper';

interface UIBuilderProps {
  /** Existing definition to edit, or null for new */
  definition: UIDefinition | null;
  /** Module ID for creating new UIs */
  moduleId?: string;
  onBack: () => void;
  /** After "Save & Run": opens the saved app in the runner. */
  onSaved: (id: string) => void;
  /** After "Save" (staying in the builder), e.g. to refresh recent apps. */
  onSavedInPlace?: (id: string) => void;
}

/** Comparable form of a definition: the save timestamp is not an edit. */
const serialize = (d: UIDefinition) => JSON.stringify({ ...d, updatedAt: '' });

interface UndoEntry {
  /** The definition before the edit. */
  def: UIDefinition;
  label: string;
  coalesceKey?: string;
  at: number;
  /** Module and step before a Replace Module, restored with the definition. */
  binding?: { module: Module | null; step: Step | null };
}

const MAX_UNDO = 50;
/** Edits with the same key within this window (one typing burst) undo as one. */
const COALESCE_MS = 1500;
const NEW_SECTION = '__new-section__';

/** Ctrl+Z belongs to the text field when the user is typing in one. */
const isTextEntry = (el: EventTarget | null): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
};

const newSectionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const UIBuilder: React.FC<UIBuilderProps> = ({
  definition: initialDef,
  moduleId,
  onBack,
  onSaved,
  onSavedInPlace,
}) => {
  const effectiveModuleId = initialDef?.moduleId ?? moduleId ?? '';

  const [module, setModule] = useState<Module | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [def, setDef] = useState<UIDefinition | null>(initialDef);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [showReplaceModule, setShowReplaceModule] = useState(false);
  const [showShare, setShowShare] = useState(false);

  // Dirty tracking: the last saved (or freshly generated) definition.
  const [baseline, setBaseline] = useState<string | null>(initialDef ? serialize(initialDef) : null);
  const [hasSaved, setHasSaved] = useState(!!initialDef);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  // The held navigation while the "unsaved changes" dialog is open.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [driftDismissed, setDriftDismissed] = useState(false);

  const defRef = useRef(def);
  defRef.current = def;

  const isDirty = useMemo(
    () => !!def && baseline !== null && serialize(def) !== baseline,
    [def, baseline]
  );
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const { steps } = useSteps(effectiveModuleId);

  // Load module
  useEffect(() => {
    if (!effectiveModuleId) {
      setLoadError('No module specified');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getModule(effectiveModuleId)
      .then(m => { if (!cancelled) setModule(m); })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load module');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveModuleId]);

  // Pick the step: the definition's own step when editing, the scoreable one
  // (with a generated layout) when creating. `steps` belong to the module the
  // builder opened with; after Replace Module they describe the old module,
  // so they are ignored then (the dialog has set the new step).
  useEffect(() => {
    if (!module || steps.length === 0) return;
    if (steps.every(s => s.moduleId && s.moduleId !== module.id)) return;

    const current = defRef.current;
    const scoreable = getScoreableStep(module, steps);
    if (!current) {
      if (scoreable) {
        const generated = generateDefaultUI(module.id, scoreable, `${module.name} UI`);
        setDef(generated);
        setBaseline(serialize(generated));
        setStep(scoreable);
      } else {
        setLoadError('No scoreable step found (needs score or execute step)');
      }
      return;
    }
    setStep(steps.find(s => s.id === current.stepId) ?? scoreable ?? null);
  }, [module, steps]);

  // --- Edits and undo ---------------------------------------------------

  const applyChange = useCallback((
    next: UIDefinition,
    label: string,
    coalesceKey?: string,
    binding?: UndoEntry['binding']
  ) => {
    const prev = defRef.current;
    if (prev) {
      const now = Date.now();
      setUndoStack(stack => {
        const top = stack[stack.length - 1];
        if (coalesceKey && top?.coalesceKey === coalesceKey && now - top.at < COALESCE_MS) {
          return [...stack.slice(0, -1), { ...top, at: now }];
        }
        return [...stack, { def: prev, label, coalesceKey, at: now, binding }].slice(-MAX_UNDO);
      });
    }
    setDef(next);
  }, []);

  const undoLabel = undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null;

  const handleUndo = useCallback(() => {
    const top = undoStack[undoStack.length - 1];
    if (!top) return;
    setUndoStack(undoStack.slice(0, -1));
    setDef(top.def);
    if (top.binding) {
      setModule(top.binding.module);
      setStep(top.binding.step);
    }
    setSelectionResetKey(k => k + 1);
    setAnnouncement(`Undone: ${top.label}`);
  }, [undoStack]);

  // Ctrl+Z / Cmd+Z, except while typing (the field's own undo) or in a dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (isPreview || pendingLeave || isAnyModalOpen() || isTextEntry(e.target)) return;
      if (undoStack.length === 0) return;
      e.preventDefault();
      handleUndo();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, isPreview, pendingLeave, undoStack.length]);

  // --- Saving ------------------------------------------------------------

  /** Save the current definition; true on success. */
  const save = useCallback(async (): Promise<UIDefinition | null> => {
    const current = defRef.current;
    if (!current) return null;
    setSaving(true);
    setSaveMessage(null);
    try {
      // A copy: saveUIDefinition stamps updatedAt on the object it is given.
      const toSave = { ...current };
      await saveUIDefinition(toSave);
      setBaseline(serialize(toSave));
      setHasSaved(true);
      return toSave;
    } catch (err) {
      setSaveMessage(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const saved = await save();
    if (saved) {
      setSaveMessage('Saved. You can keep editing.');
      onSavedInPlace?.(saved.id);
    }
  }, [save, onSavedInPlace]);

  const handleSaveAndRun = useCallback(async () => {
    const saved = await save();
    if (saved) onSaved(saved.id);
  }, [save, onSaved]);

  // A success note fades after a while; a failure stays until dismissed.
  useEffect(() => {
    if (!saveMessage || saveMessage.startsWith('Save failed')) return;
    const timer = window.setTimeout(() => setSaveMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  // --- Leaving with unsaved changes ----------------------------------------

  useEffect(() => installLeaveGuard({
    isDirty: () => dirtyRef.current,
    confirm: (proceed) => setPendingLeave(() => proceed),
  }), []);

  const handleBack = useCallback(() => runWithLeaveGuard(onBack), [onBack]);

  const handleStay = () => setPendingLeave(null);

  const handleDiscardAndLeave = () => {
    const proceed = pendingLeave;
    setPendingLeave(null);
    proceed?.();
  };

  const handleSaveAndLeave = async () => {
    const proceed = pendingLeave;
    const saved = await save();
    if (!saved) {
      setPendingLeave(null);
      return;
    }
    onSavedInPlace?.(saved.id);
    setPendingLeave(null);
    proceed?.();
  };

  // --- Signature drift ---------------------------------------------------

  // Stored fields compared with the module's current step signature. Only
  // for the definition's own step, so a fallback step cannot flag every field.
  const drift = useMemo(
    () => (step && def && def.stepId === step.id ? computeSignatureDrift(def, step) : null),
    [def, step]
  );

  const handleAddNewParameters = (sectionId: string) => {
    if (!def || !drift) return;
    const params = [
      ...drift.newInputs.map(p => ({ p, dir: 'input' as const })),
      ...drift.newOutputs.map(p => ({ p, dir: 'output' as const })),
    ];
    if (params.length === 0) return;
    let sections: UISection[] = def.layout.sections;
    let targetId = sectionId;
    if (sectionId === NEW_SECTION || !sections.some(s => s.id === sectionId)) {
      targetId = newSectionId();
      sections = [...sections, { id: targetId, title: 'New Parameters', fields: [] }];
    }
    sections = sections.map(s => {
      if (s.id !== targetId) return s;
      const start = s.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      return {
        ...s,
        fields: [...s.fields, ...params.map(({ p, dir }, i) => createFieldForParameter(p, dir, start + i))],
      };
    });
    applyChange(
      { ...def, layout: { ...def.layout, sections } },
      `Add ${params.length} new parameter${params.length === 1 ? '' : 's'}`
    );
    setAnnouncement(`Added ${params.length} field${params.length === 1 ? '' : 's'}.`);
  };

  const handleRemoveOrphans = () => {
    if (!def || !drift || drift.orphaned.length === 0) return;
    const orphaned = new Set(drift.orphaned.map(o => o.field));
    const sections = def.layout.sections.map(s => ({
      ...s,
      fields: s.fields.filter(f => !orphaned.has(f)),
    }));
    const n = drift.orphaned.length;
    applyChange(
      { ...def, layout: { ...def.layout, sections } },
      `Remove ${n} orphaned field${n === 1 ? '' : 's'}`
    );
    setSelectionResetKey(k => k + 1);
    setAnnouncement(`Removed ${n} field${n === 1 ? '' : 's'}. Undo restores ${n === 1 ? 'it' : 'them'}.`);
  };

  if (loading) return <Loading message="Loading module..." />;

  if (loadError || !def) {
    return (
      <div className="ui-builder">
        <PageHeader
          title="UI Builder"
          breadcrumbs={[{ label: 'UI Apps', onClick: onBack }, { label: 'Builder' }]}
        />
        <Alert variant="error" title="Error">{loadError || 'Could not initialize builder'}</Alert>
      </div>
    );
  }

  const newParamCount = drift ? drift.newInputs.length + drift.newOutputs.length : 0;

  return (
    <div className="ui-builder">
      <PageHeader
        title={initialDef ? `Edit: ${def.name}` : 'Create UI App'}
        subtitle={module ? `Module: ${module.name}` : undefined}
        breadcrumbs={[
          { label: 'UI Apps', onClick: handleBack },
          { label: def.name },
        ]}
      />

      {saveMessage && (
        <Alert
          variant={saveMessage.startsWith('Save failed') ? 'error' : 'success'}
          dismissible
          onClose={() => setSaveMessage(null)}
        >
          {saveMessage}
        </Alert>
      )}

      {!driftDismissed && hasSignatureDrift(drift) && (
        <Alert
          variant="warning"
          title={`Compared with the module's current step signature: ${describeSignatureDrift(drift)}`}
          dismissible
          onClose={() => setDriftDismissed(true)}
          actions={
            <div className="ui-builder__drift-actions">
              {newParamCount > 0 && (
                <MenuButton
                  label="Add to section…"
                  ariaLabel={`Add ${newParamCount} new parameter${newParamCount === 1 ? '' : 's'} to a section`}
                  items={[
                    ...def.layout.sections.map(s => ({
                      id: s.id,
                      label: s.title || '(untitled)',
                      onSelect: () => handleAddNewParameters(s.id),
                    })),
                    { id: NEW_SECTION, label: 'New section', onSelect: () => handleAddNewParameters(NEW_SECTION) },
                  ]}
                />
              )}
              {drift.orphaned.length > 0 && (
                <Button variant="secondary" size="small" onClick={handleRemoveOrphans}>
                  Remove orphaned fields
                </Button>
              )}
            </div>
          }
        >
          <ul className="ui-builder__drift-list">
            {drift.newInputs.length > 0 && (
              <li>
                New inputs with no field (sent as missing, null, until added):{' '}
                <strong>{drift.newInputs.map(p => p.name).join(', ')}</strong>
              </li>
            )}
            {drift.newOutputs.length > 0 && (
              <li>
                New outputs with no field: <strong>{drift.newOutputs.map(p => p.name).join(', ')}</strong>
              </li>
            )}
            {drift.orphaned.length > 0 && (
              <li>
                Fields for parameters the signature no longer lists (not sent):{' '}
                <strong>{drift.orphaned.map(o => `${o.field.label} (${o.field.parameterId})`).join(', ')}</strong>
              </li>
            )}
          </ul>
        </Alert>
      )}

      <BuilderToolbar
        definition={def}
        onNameChange={(name) => applyChange({ ...def, name }, 'Rename app', 'name')}
        onDescriptionChange={(desc) => applyChange({ ...def, description: desc || undefined }, 'Edit description', 'description')}
        onSettingsChange={(settings: UISettings) => applyChange({ ...def, settings }, 'Change app settings', 'settings')}
        onColumnsChange={(cols) => applyChange({ ...def, layout: { ...def.layout, columns: cols } }, 'Change columns')}
        onSave={handleSave}
        onSaveAndRun={handleSaveAndRun}
        onPreview={() => setIsPreview(!isPreview)}
        onShare={() => setShowShare(true)}
        onReplaceModule={initialDef ? () => setShowReplaceModule(true) : undefined}
        onUndo={handleUndo}
        undoLabel={isPreview ? null : undoLabel}
        isDirty={isDirty}
        isSaved={hasSaved}
        saving={saving}
        isPreview={isPreview}
      />

      {isPreview ? (
        <BuilderPreview definition={def} isDirty={isDirty} />
      ) : (
        <BuilderCanvas
          definition={def}
          step={step}
          onChange={applyChange}
          selectionResetKey={selectionResetKey}
        />
      )}

      {/* Undo and banner actions are announced here. */}
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>

      {showReplaceModule && (
        <ReplaceModuleDialog
          definition={def}
          currentModule={module}
          currentStep={step}
          onReplace={(newDef, newMod, newStp) => {
            applyChange(
              newDef,
              newMod.id === def.moduleId ? 'Re-sync module' : 'Replace module',
              undefined,
              { module, step }
            );
            setModule(newMod);
            setStep(newStp);
            setDriftDismissed(false);
            setShowReplaceModule(false);
          }}
          onClose={() => setShowReplaceModule(false)}
        />
      )}

      {showShare && (
        <ShareDialog definition={def} onClose={() => setShowShare(false)} />
      )}

      {pendingLeave && (
        <Modal
          title="Leave without saving?"
          onClose={handleStay}
          size="small"
          footer={
            <>
              <Button variant="tertiary" onClick={handleStay}>Stay</Button>
              <Button variant="danger" onClick={handleDiscardAndLeave}>Discard Changes</Button>
              <Button variant="primary" onClick={handleSaveAndLeave} loading={saving}>Save and Leave</Button>
            </>
          }
        >
          <p>
            &ldquo;{def.name}&rdquo; has changes that are not saved. Leaving now discards them.
          </p>
        </Modal>
      )}
    </div>
  );
};
