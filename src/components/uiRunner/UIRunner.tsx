// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UIDefinition } from '../../types/uiBuilder';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { PageHeader } from '../layout/Layout';
import { DynamicForm } from './DynamicForm';
import { useStepExecution, useStep } from '../../hooks';
import { getModule } from '../../api/modules';
import { Module } from '../../types';
import {
  buildRunValues,
  computeSignatureDrift,
  getInitialInputValues,
  hasSignatureDrift,
} from '../../utils/uiDefaults';
import { validateInputs } from './fieldValidation';

interface UIRunnerProps {
  definition: UIDefinition;
  onBack: () => void;
  onEdit: () => void;
  standalone?: boolean;
  /** Present when the app was opened from a self-contained share link. */
  shareToken?: string;
  /** When set (shared mode), saves the embedded app into the local library. */
  onSaveCopy?: () => void;
  /**
   * Builder preview: run the real module with an unsaved definition. No page
   * header or navigation, and no signature notice (the builder shows its own).
   */
  preview?: boolean;
}

const nameList = (names: string[]) => names.join(', ');

export const UIRunner: React.FC<UIRunnerProps> = ({
  definition,
  onBack,
  onEdit,
  standalone = false,
  shareToken,
  onSaveCopy,
  preview = false,
}) => {
  const navigate = useNavigate();

  // Preserve the share token across the standalone toggle so a shared link
  // stays self-contained when switching in or out of standalone mode.
  const tokenSuffix = shareToken ? `&def=${shareToken}` : '';

  const handleOpenStandalone = useCallback(() => {
    navigate(`/ui-apps/${encodeURIComponent(definition.id)}?standalone=true${tokenSuffix}`);
  }, [navigate, definition.id, tokenSuffix]);

  const handleExitStandalone = useCallback(() => {
    navigate(`/ui-apps/${encodeURIComponent(definition.id)}${shareToken ? `?def=${shareToken}` : ''}`);
  }, [navigate, definition.id, shareToken]);

  // Seeded with every default and each slider's minimum, so what is on
  // screen is what is sent.
  const [inputValues, setInputValues] = useState<Record<string, unknown>>(
    () => getInitialInputValues(definition)
  );

  const [outputValues, setOutputValues] = useState<Record<string, unknown>>({});
  const [module, setModule] = useState<Module | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  // Pre-run check: off until the first blocked run, then live as the user
  // corrects fields. The counter remounts the summary so each blocked run is
  // announced, and asks the form to focus the first invalid field.
  const [blockedRuns, setBlockedRuns] = useState(0);
  const [driftDismissed, setDriftDismissed] = useState(false);

  // The step signature gates execution; the definition itself (layout, fields,
  // defaults) is already in hand, so the form renders before either fetch lands.
  const { step, error: stepError } = useStep(definition.moduleId, definition.stepId);

  // Load the module. It only feeds the module-name badge (which falls back to
  // the id) and the "removed from MAS" error, so it does not gate rendering;
  // a response for a module the user has navigated away from is dropped.
  useEffect(() => {
    let cancelled = false;
    setModule(null);
    setModuleError(null);
    getModule(definition.moduleId)
      .then(m => { if (!cancelled) setModule(m); })
      .catch(err => {
        if (!cancelled) setModuleError(err instanceof Error ? err.message : 'Failed to load module');
      });
    return () => { cancelled = true; };
  }, [definition.moduleId]);

  const loadError = moduleError
    ?? (stepError ? `Step "${definition.stepId}" could not be loaded: ${stepError}` : null);

  const { output, executing, error, executionTime, executeWithValues, reset } =
    useStepExecution(definition.moduleId, definition.stepId);

  // Stored fields compared with the step's current signature; only once the
  // step has loaded, or every field would look removed.
  const drift = useMemo(
    () => (step ? computeSignatureDrift(definition, step) : null),
    [definition, step]
  );

  const fieldErrors = useMemo(
    () => (blockedRuns > 0 ? validateInputs(definition, step, inputValues) : {}),
    [blockedRuns, definition, step, inputValues]
  );
  const invalidCount = Object.keys(fieldErrors).length;

  // Map outputs when execution completes
  useEffect(() => {
    if (output?.outputs) {
      const vals: Record<string, unknown> = {};
      for (const v of output.outputs) {
        vals[v.name] = v.value;
      }
      setOutputValues(vals);
    }
  }, [output, definition.layout.sections]);

  const handleExecute = useCallback(async () => {
    if (!step) return;
    const errors = validateInputs(definition, step, inputValues);
    if (Object.keys(errors).length > 0) {
      setBlockedRuns(n => n + 1);
      return;
    }
    setBlockedRuns(0);
    try {
      // Converted by the signature's types; fields whose parameter the step
      // no longer lists are left out, and step inputs without a field go out
      // as null (buildStepInput fills every step input).
      await executeWithValues(step, buildRunValues(definition, step, inputValues));
    } catch {
      // Error handled by hook
    }
  }, [step, definition, inputValues, executeWithValues]);

  const handleReset = useCallback(() => {
    setInputValues(getInitialInputValues(definition));
    setOutputValues({});
    setBlockedRuns(0);
    reset();
  }, [reset, definition]);

  if (loadError) {
    return (
      <div className="ui-runner">
        {!preview && (
          <PageHeader
            title={definition.name}
            breadcrumbs={[{ label: 'UI Apps', onClick: onBack }, { label: definition.name }]}
          />
        )}
        <Alert variant="error" title="Failed to load">
          {loadError}. The module "{definition.moduleId}" may have been removed from MAS.
        </Alert>
      </div>
    );
  }

  const title = definition.settings.title || definition.name;
  const submitLabel = definition.settings.submitLabel || 'Execute';
  const outputLayout = definition.settings.outputLayout || 'below';

  // Unified layout for inline/below modes
  const unifiedLayout = definition.layout;

  const fieldLabel = (parameterId: string) => {
    for (const s of definition.layout.sections) {
      const f = s.fields.find(x => x.parameterId === parameterId);
      if (f) return f.label;
    }
    return parameterId;
  };

  // One header for every output layout, so a shared link offers "Save to My
  // UI Apps" whichever layout the app uses. A shared app is not in the
  // recipient's library, so Edit would open an empty builder; saving a copy
  // (under a fresh id) is the way to edit it.
  const renderHeader = (leadingBadges?: React.ReactNode) => {
    if (preview) {
      return leadingBadges ? <div className="ui-runner__header-actions">{leadingBadges}</div> : null;
    }
    return (
      <>
        {standalone && (
          <div className="ui-runner__standalone-bar">
            <span className="ui-runner__standalone-title">{title}</span>
            <Button variant="tertiary" size="small" onClick={handleExitStandalone}>
              Exit Standalone
            </Button>
          </div>
        )}
        {!standalone && (
          <PageHeader
            title={title}
            subtitle={definition.description}
            breadcrumbs={[
              { label: 'UI Apps', onClick: onBack },
              { label: definition.name },
            ]}
            actions={
              <div className="ui-runner__header-actions">
                {leadingBadges}
                <Badge variant="info">{module?.name ?? definition.moduleId}</Badge>
                <Button variant="tertiary" onClick={handleOpenStandalone}>Standalone</Button>
                {shareToken ? (
                  onSaveCopy && <Button variant="secondary" onClick={onSaveCopy}>Save to My UI Apps</Button>
                ) : (
                  <Button variant="secondary" onClick={onEdit}>Edit</Button>
                )}
                <Button variant="tertiary" onClick={onBack}>Back</Button>
              </div>
            }
          />
        )}
      </>
    );
  };

  // Non-blocking: the app still runs. Says exactly what the comparison found
  // and what that means for the request.
  const driftNotice = !preview && !driftDismissed && hasSignatureDrift(drift) && (
    <Alert
      variant="warning"
      title="This app's fields differ from the module's current step signature"
      dismissible
      onClose={() => setDriftDismissed(true)}
    >
      <ul className="ui-runner__drift-list">
        {drift.newInputs.length > 0 && (
          <li>
            Inputs in the signature with no field in this app are sent as missing (null):{' '}
            <strong>{nameList(drift.newInputs.map(p => p.name))}</strong>.
          </li>
        )}
        {drift.orphaned.length > 0 && (
          <li>
            Fields for parameters the signature no longer lists are not sent (inputs) or stay empty (outputs):{' '}
            <strong>{nameList(drift.orphaned.map(o => o.field.label))}</strong>.
          </li>
        )}
        {drift.newOutputs.length > 0 && (
          <li>
            Outputs in the signature that this app does not show:{' '}
            <strong>{nameList(drift.newOutputs.map(p => p.name))}</strong>.
          </li>
        )}
      </ul>
      {shareToken
        ? 'Save the app to your library to edit it.'
        : 'Edit the app to add or remove these fields.'}
    </Alert>
  );

  const validationSummary = invalidCount > 0 && (
    <Alert key={blockedRuns} variant="error" title="Not run: check the highlighted fields">
      {invalidCount === 1 ? '1 field needs' : `${invalidCount} fields need`} attention:{' '}
      {nameList(Object.keys(fieldErrors).map(fieldLabel))}. These checks cover only the
      step signature's types and sizes and this app's field settings.
    </Alert>
  );

  const previewBadge = preview && <Badge variant="warning">Preview run</Badge>;

  const executeButton = (
    <Button
      variant="primary"
      size="large"
      onClick={handleExecute}
      loading={executing}
      disabled={executing || !step}
    >
      {executing ? 'Executing...' : submitLabel}
    </Button>
  );

  if (outputLayout === 'side-by-side') {
    // Separate input and output sections for side-by-side layout
    const hasInputFields = definition.layout.sections.some(s =>
      s.fields.some(f => f.direction === 'input' && f.visible)
    );
    const hasOutputFields = definition.layout.sections.some(s =>
      s.fields.some(f => f.direction === 'output' && f.visible)
    );

    // Build separate input-only and output-only layouts; static fields go
    // into the input side.
    const inputLayout = {
      ...definition.layout,
      sections: definition.layout.sections.map(s => ({
        ...s,
        fields: s.fields.filter(f => f.direction === 'input' || f.direction === 'static'),
      })).filter(s => s.fields.length > 0),
    };

    const outputLayout_ = {
      ...definition.layout,
      sections: definition.layout.sections.map(s => ({
        ...s,
        fields: s.fields.filter(f => f.direction === 'output'),
      })).filter(s => s.fields.length > 0),
    };

    return (
      <div className="ui-runner">
        {renderHeader(
          <>
            {previewBadge}
            {definition.settings.showExecutionTime && executionTime && (
              <Badge variant="default">{executionTime.toFixed(0)}ms</Badge>
            )}
          </>
        )}

        {driftNotice}

        <div className="ui-runner__content ui-runner__content--side-by-side">
          {/* Input side */}
          {hasInputFields && (
            <Card>
              <CardBody>
                <DynamicForm
                  layout={inputLayout}
                  inputValues={inputValues}
                  outputValues={outputValues}
                  onInputChange={setInputValues}
                  disabled={executing}
                  inputParameters={step?.inputs}
                  fieldErrors={fieldErrors}
                  focusErrorsRequest={blockedRuns}
                />
              </CardBody>
              <CardFooter>
                {executeButton}
              </CardFooter>
            </Card>
          )}

          {/* Output side */}
          {hasOutputFields && (
            <Card>
              <CardBody>
                <DynamicForm
                  layout={outputLayout_}
                  inputValues={inputValues}
                  outputValues={outputValues}
                  onInputChange={setInputValues}
                  disabled={true}
                />
              </CardBody>
            </Card>
          )}
        </div>

        {validationSummary}

        {error && (
          <Alert variant="error" title="Execution Error" dismissible onClose={reset}>
            {error}
          </Alert>
        )}
      </div>
    );
  }

  // Inline or below: single unified card
  return (
    <div className="ui-runner">
      {renderHeader()}

      {driftNotice}

      <Card>
        <CardHeader
          actions={
            <div className="ui-runner__header-actions">
              {previewBadge}
              {definition.settings.showExecutionTime && executionTime && (
                <Badge variant="default">{executionTime.toFixed(0)}ms</Badge>
              )}
              <Button variant="tertiary" size="small" onClick={handleReset}>
                Clear All
              </Button>
            </div>
          }
        >
          <h3>{title}</h3>
        </CardHeader>
        <CardBody>
          <DynamicForm
            layout={unifiedLayout}
            inputValues={inputValues}
            outputValues={outputValues}
            onInputChange={setInputValues}
            disabled={executing}
            inputParameters={step?.inputs}
            fieldErrors={fieldErrors}
            focusErrorsRequest={blockedRuns}
          />
        </CardBody>
        <CardFooter>
          {executeButton}
        </CardFooter>
      </Card>

      {validationSummary}

      {error && (
        <Alert variant="error" title="Execution Error" dismissible onClose={reset}>
          {error}
        </Alert>
      )}
    </div>
  );
};
