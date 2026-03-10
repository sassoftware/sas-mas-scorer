// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from 'react';
import { UIDefinition, UISettings } from '../../types/uiBuilder';
import { Step, Module } from '../../types';
import { PageHeader } from '../layout/Layout';
import { Loading } from '../common/Loading';
import { Alert } from '../common/Alert';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { BuilderPreview } from './BuilderPreview';
import { useSteps } from '../../hooks';
import { getModule } from '../../api/modules';
import { saveUIDefinition } from '../../storage/uiStorage';
import { generateDefaultUI } from '../../utils/uiDefaults';
import { getScoreableStep } from '../../utils/moduleHelper';

interface UIBuilderProps {
  /** Existing definition to edit, or null for new */
  definition: UIDefinition | null;
  /** Module ID for creating new UIs */
  moduleId?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

export const UIBuilder: React.FC<UIBuilderProps> = ({
  definition: initialDef,
  moduleId,
  onBack,
  onSaved,
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

  const { steps } = useSteps(effectiveModuleId);

  // Load module
  useEffect(() => {
    if (!effectiveModuleId) {
      setLoadError('No module specified');
      setLoading(false);
      return;
    }
    setLoading(true);
    getModule(effectiveModuleId)
      .then(m => setModule(m))
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Failed to load module'))
      .finally(() => setLoading(false));
  }, [effectiveModuleId]);

  // Auto-detect step and generate default UI for new definitions
  useEffect(() => {
    if (!module || steps.length === 0) return;

    const scoreable = getScoreableStep(module, steps);
    if (scoreable) {
      setStep(scoreable);
      // Generate default if creating new
      if (!def) {
        setDef(generateDefaultUI(module.id, scoreable, `${module.name} UI`));
      }
    } else if (initialDef) {
      // Editing existing — find the step by ID
      const found = steps.find(s => s.id === initialDef.stepId);
      setStep(found ?? null);
    } else {
      setLoadError('No scoreable step found (needs score or execute step)');
    }
  }, [module, steps, def, initialDef]);

  const handleSave = useCallback(async () => {
    if (!def) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await saveUIDefinition(def);
      setSaveMessage('Saved successfully');
      setTimeout(() => setSaveMessage(null), 2000);
      onSaved(def.id);
    } catch (err) {
      setSaveMessage(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [def, onSaved]);

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

  return (
    <div className="ui-builder">
      <PageHeader
        title={initialDef ? `Edit: ${def.name}` : 'Create UI App'}
        subtitle={module ? `Module: ${module.name}` : undefined}
        breadcrumbs={[
          { label: 'UI Apps', onClick: onBack },
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

      <BuilderToolbar
        definition={def}
        onNameChange={(name) => setDef({ ...def, name })}
        onDescriptionChange={(desc) => setDef({ ...def, description: desc || undefined })}
        onSettingsChange={(settings: UISettings) => setDef({ ...def, settings })}
        onColumnsChange={(cols) => setDef({ ...def, layout: { ...def.layout, columns: cols } })}
        onSave={handleSave}
        onPreview={() => setIsPreview(!isPreview)}
        saving={saving}
        isPreview={isPreview}
      />

      {isPreview ? (
        <BuilderPreview definition={def} />
      ) : (
        <BuilderCanvas
          definition={def}
          step={step}
          onChange={setDef}
        />
      )}
    </div>
  );
};
