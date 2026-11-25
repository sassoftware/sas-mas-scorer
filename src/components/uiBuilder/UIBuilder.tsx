// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UIDefinition, UILayout } from '../../types/uiBuilder';
import { Step, Module } from '../../types';
import { PageHeader } from '../layout/Layout';
import { Loading } from '../common/Loading';
import { Alert } from '../common/Alert';
import { Button } from '../common/Button';
import { Modal, isAnyModalOpen } from '../common/Modal';
import { BuilderBar } from './canvas/BuilderBar';
import { CanvasEditor } from './canvas/CanvasEditor';
import { BuilderPreview } from './BuilderPreview';
import { ReplaceModuleDialog } from './ReplaceModuleDialog';
import { ShareDialog } from './ShareDialog';
import { installLeaveGuard, runWithLeaveGuard } from './leaveGuard';
import { useSteps } from '../../hooks';
import { getModule } from '../../api/modules';
import { saveUIDefinition } from '../../storage/uiStorage';
import {
  computeSignatureDrift,
  describeSignatureDrift,
  generateDefaultUI,
  hasSignatureDrift,
  applyDateKinds,
  applyGridSchemas,
} from '../../utils/uiDefaults';
import { getScoreableStep } from '../../utils/moduleHelper';
import { inspectEndpoint, scrStep } from '../../api/scr';
import { DateKinds, getDecisionDateKinds, getDecisionGridSchemas, GridSchema } from '../../api/decisionDateTypes';
import { modelIdOf } from '../uiRunner/ModelInfoPanel';
import { decisionSourceOf } from '../uiRunner/SaveScenarioButton';

interface UIBuilderProps {
  /** Existing definition to edit, or null for new */
  definition: UIDefinition | null;
  /** Module ID for creating new UIs */
  moduleId?: string;
  /** SCR score URL for creating a new UI on an SCR endpoint (instead of moduleId). */
  scrUrl?: string;
  /** Display name for a new SCR-based app (the saved endpoint's label). */
  scrLabel?: string;
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

/** Ctrl+Z belongs to the text field when the user is typing in one. */
const isTextEntry = (el: EventTarget | null): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
};

/** The definition with nothing on the page yet (the canvas-first starting point). */


export const UIBuilder: React.FC<UIBuilderProps> = ({
  definition: initialDef,
  moduleId,
  scrUrl: newScrUrl,
  scrLabel,
  onBack,
  onSaved,
  onSavedInPlace,
}) => {
  // An SCR app has no MAS module: its signature comes from the endpoint.
  const scrUrl = initialDef ? initialDef.scrUrl : newScrUrl;
  const effectiveModuleId = scrUrl ? '' : initialDef?.moduleId ?? moduleId ?? '';

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
  // What "Use template" puts back on an emptied page: the generated layout.
  const [generatedLayout, setGeneratedLayout] = useState<UILayout | null>(null);
  // Date and datetime parameters, from the decision the module was published from.
  const [dateKinds, setDateKinds] = useState<DateKinds>({});
  // DataGrid inputs' declared columns, from the same decision.
  const [gridSchemas, setGridSchemas] = useState<Record<string, GridSchema>>({});

  const defRef = useRef(def);
  defRef.current = def;

  const isDirty = useMemo(
    () => !!def && baseline !== null && serialize(def) !== baseline,
    [def, baseline]
  );
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const { steps, loading: stepsLoading, error: stepsError, loadedModuleId } = useSteps(effectiveModuleId);

  // SCR: read the endpoint's signature; it stands in for the module's step.
  useEffect(() => {
    if (!scrUrl) return;
    let cancelled = false;
    setLoading(true);
    inspectEndpoint(scrUrl)
      .then(info => {
        if (cancelled) return;
        const current = defRef.current;
        const endpointStep = scrStep(info, current?.stepId);
        setStep(endpointStep);
        if (!current) {
          const generated = generateDefaultUI(info.name, endpointStep, `${scrLabel || info.name} UI`);
          generated.scrUrl = info.scoreUrl;
          // Python images reject a record that leaves any input out.
          if (info.inputsRequired) {
            for (const section of generated.layout.sections) {
              for (const f of section.fields) {
                if (f.direction === 'input') f.validation = { ...f.validation, required: true };
              }
            }
          }
          // A new app starts with every input and result on the page.
          setGeneratedLayout(generated.layout);
          setDef(generated);
          setBaseline(serialize(generated));
        }
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(`The SCR endpoint ${scrUrl} did not answer: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scrUrl, scrLabel]);

  // Load module
  useEffect(() => {
    if (scrUrl) return;
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
  }, [effectiveModuleId, scrUrl]);

  // Pick the step: the definition's own step when editing, the scoreable one
  // (with a generated layout) when creating. `steps` belong to the module the
  // builder opened with; after Replace Module they describe the old module,
  // so they are ignored then (the dialog has set the new step).
  // A module MAS lists no steps for (or whose steps can't be read) has nothing to build from.
  useEffect(() => {
    if (scrUrl || !module || stepsLoading || steps.length > 0 || defRef.current) return;
    if (!loadedModuleId || loadedModuleId !== effectiveModuleId) return;
    setLoadError(stepsError
      ? `Could not read the steps of the module "${module.name}": ${stepsError}`
      : `MAS lists no steps for the module "${module.name}", so there is nothing to build a form from. Check the module in MAS or publish it again.`);
  }, [scrUrl, module, steps, stepsLoading, stepsError, loadedModuleId, effectiveModuleId]);

  useEffect(() => {
    if (!module || steps.length === 0) return;
    if (steps.every(s => s.moduleId && s.moduleId !== module.id)) return;

    const current = defRef.current;
    const scoreable = getScoreableStep(module, steps);
    if (!current) {
      if (scoreable) {
        // Dates and datetimes get their pickers from the start: read the
        // decision's types first (an empty answer for other modules).
        Promise.all([getDecisionDateKinds(module), getDecisionGridSchemas(module)]).then(([kinds, grids]) => {
          if (defRef.current) return;
          const generated = applyGridSchemas(
            applyDateKinds(generateDefaultUI(module.id, scoreable, `${module.name} UI`), kinds),
            grids
          );
          setDateKinds(kinds);
          setGridSchemas(grids);
          setGeneratedLayout(generated.layout);
          setDef(generated);
          setBaseline(serialize(generated));
          setStep(scoreable);
        });
      } else {
        setLoadError('No scoreable step found (needs score or execute step)');
      }
      return;
    }
    setStep(steps.find(s => s.id === current.stepId) ?? scoreable ?? null);
    getDecisionDateKinds(module).then(setDateKinds);
    getDecisionGridSchemas(module).then(setGridSchemas);
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

  if (loading) return <Loading message={scrUrl ? 'Reading the endpoint signature...' : 'Loading module...'} />;

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

  // Canvas first: parameters with no field are normal (the field list offers
  // them), so only fields whose parameter left the signature are flagged.
  const orphanDrift = drift && drift.orphaned.length > 0 ? { ...drift, newInputs: [], newOutputs: [] } : null;
  const templateLayout = generatedLayout
    ?? (step ? generateDefaultUI(def.moduleId, step, def.name).layout : null);
  const source = scrUrl ? `SCR endpoint: ${scrUrl}` : module ? `MAS module: ${module.name}` : '';

  const appName = def.name || 'Untitled app';
  const topBar = (
    <div className="cb-top">
      <nav className="cb-top__crumbs" aria-label="Breadcrumb">
        <ol className="sas-breadcrumbs">
          <li className="sas-breadcrumbs__item">
            <button type="button" className="sas-breadcrumbs__link" onClick={handleBack}>UI Apps</button>
            <span className="sas-breadcrumbs__separator">/</span>
          </li>
          <li className="sas-breadcrumbs__item">
            {/* The page's heading: the app's name, as the title bar of the app. */}
            <h1 className="cb-top__title" aria-current="page">{appName}</h1>
          </li>
        </ol>
      </nav>
      <BuilderBar
        isPreview={isPreview}
        onModeChange={setIsPreview}
        onSave={handleSave}
        onSaveAndRun={handleSaveAndRun}
        onShare={() => setShowShare(true)}
        onReplaceModule={initialDef && !scrUrl ? () => setShowReplaceModule(true) : undefined}
        onUndo={handleUndo}
        undoLabel={isPreview ? null : undoLabel}
        isDirty={isDirty}
        isSaved={hasSaved}
        saving={saving}
      />
    </div>
  );

  const showDrift = !driftDismissed && hasSignatureDrift(orphanDrift);
  const notices = (saveMessage || showDrift) ? (
    <>
      {saveMessage && (
        <Alert
          variant={saveMessage.startsWith('Save failed') ? 'error' : 'success'}
          dismissible
          onClose={() => setSaveMessage(null)}
        >
          {saveMessage}
        </Alert>
      )}

      {showDrift && orphanDrift && (
        <Alert
          variant="warning"
          title={`Compared with the ${scrUrl ? "endpoint's current" : "module's current step"} signature: ${describeSignatureDrift(orphanDrift)}`}
          dismissible
          onClose={() => setDriftDismissed(true)}
          actions={
            <Button variant="secondary" size="small" onClick={handleRemoveOrphans}>
              Remove orphaned fields
            </Button>
          }
        >
          <p>
            Fields for parameters the signature no longer lists (not sent):{' '}
            <strong>{orphanDrift.orphaned.map(o => `${o.field.label} (${o.field.parameterId})`).join(', ')}</strong>
          </p>
        </Alert>
      )}
    </>
  ) : null;

  return (
    <div className="ui-builder ui-builder--full">
      {isPreview ? (
        <div className="cb cb--preview">
          <div className="cb-center">
            {topBar}
            {notices && <div className="cb-notices">{notices}</div>}
            <div className="cb-preview">
              <BuilderPreview definition={def} isDirty={isDirty} />
            </div>
          </div>
        </div>
      ) : (
        <CanvasEditor
          definition={def}
          step={step}
          dateKinds={dateKinds}
          gridSchemas={gridSchemas}
          isModelModule={!scrUrl && !!modelIdOf(module)}
          isDecisionModule={!scrUrl && !!decisionSourceOf(module)}
          source={source}
          onChange={applyChange}
          selectionResetKey={selectionResetKey}
          templateLayout={templateLayout}
          announce={setAnnouncement}
          topBar={topBar}
          notices={notices}
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
