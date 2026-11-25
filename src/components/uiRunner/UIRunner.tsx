// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { prefillFromQuery } from '../../utils/prefill';
import { UIDefinition } from '../../types/uiBuilder';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Badge } from '../common/Badge';
import { PageHeader } from '../layout/Layout';
import { DynamicForm, shownSections } from './DynamicForm';
import { ModelInfoPanel, modelIdOf } from './ModelInfoPanel';
import { RunMessages } from './RunMessages';
import { LastRun, ResultDownloads } from './ResultDownloads';
import { BatchFromFile } from './BatchFromFile';
import { RunHistory } from '../scoring/RunHistory';
import { RunRecord, useRunHistory } from '../scoring/scoringSession';
import { useStepExecution, useStep } from '../../hooks';
import { getModule } from '../../api/modules';
import { Module, Step } from '../../types';
import { inspectEndpoint, scoreForApp, scrStep, type ScrEndpointInfo } from '../../api/scr';
import {
  buildRunValues,
  findParameter,
  computeSignatureDrift,
  getInitialInputValues,
  hasSignatureDrift,
  getSubmitPosition,
  accentButtonStyle,
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
  // Inputs filled from the app link (?name=value), named in a note.
  const location = useLocation();
  const [prefilled, setPrefilled] = useState<string[] | null>(null);
  // Run history (when the app turns it on): kept in this browser tab, per app.
  const { runs: history, record: recordRun, clear: clearHistory } = useRunHistory(`uiapp:${definition.id}`);
  // What the last run sent, for the result downloads.
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  // Tabs or steps: which shown section is on screen, and the step whose
  // fields Next found problems in (only that step's errors show).
  const [activeSection, setActiveSection] = useState(0);
  const [stepCheck, setStepCheck] = useState<string | null>(null);
  const [module, setModule] = useState<Module | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  // Pre-run check: off until the first blocked run, then live as the user
  // corrects fields. The counter remounts the summary so each blocked run is
  // announced, and asks the form to focus the first invalid field.
  const [blockedRuns, setBlockedRuns] = useState(0);
  const [driftDismissed, setDriftDismissed] = useState(false);

  // An SCR app scores its endpoint directly; MAS hooks get empty ids (no-ops).
  const scrUrl = definition.scrUrl;
  const masModuleId = scrUrl ? '' : definition.moduleId;
  const masStepId = scrUrl ? '' : definition.stepId;

  // The step signature gates execution; the definition itself (layout, fields,
  // defaults) is already in hand, so the form renders before either fetch lands.
  const { step: masStep, error: masStepError } = useStep(masModuleId, masStepId);

  const [scrInfo, setScrInfo] = useState<ScrEndpointInfo | null>(null);
  const [scrLoadError, setScrLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!scrUrl) return;
    let cancelled = false;
    setScrInfo(null);
    setScrLoadError(null);
    inspectEndpoint(scrUrl)
      .then(info => { if (!cancelled) setScrInfo(info); })
      .catch(err => { if (!cancelled) setScrLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [scrUrl]);
  const scrStepSig = useMemo<Step | null>(
    () => (scrInfo ? scrStep(scrInfo, definition.stepId) : null),
    [scrInfo, definition.stepId]
  );

  const step = scrUrl ? scrStepSig : masStep;
  const stepError = scrUrl ? null : masStepError;

  // Load the module. It only feeds the module-name badge (which falls back to
  // the id) and the "removed from MAS" error, so it does not gate rendering;
  // a response for a module the user has navigated away from is dropped.
  useEffect(() => {
    let cancelled = false;
    setModule(null);
    setModuleError(null);
    if (!masModuleId) return;
    getModule(masModuleId)
      .then(m => { if (!cancelled) setModule(m); })
      .catch(err => {
        if (!cancelled) setModuleError(err instanceof Error ? err.message : 'Failed to load module');
      });
    return () => { cancelled = true; };
  }, [masModuleId]);

  const loadError = (scrLoadError ? `The SCR endpoint ${scrUrl} did not answer: ${scrLoadError}` : null)
    ?? moduleError
    ?? (stepError ? `Step "${definition.stepId}" could not be loaded: ${stepError}` : null);

  const masRun = useStepExecution(masModuleId, masStepId);
  const { reset: masReset, executeWithValues: masExecute } = masRun;

  // SCR execution: same contract as the MAS hook, scored against the endpoint.
  const [scrRun, setScrRun] = useState<{ executing: boolean; error: string | null; ms: number | null }>(
    { executing: false, error: null, ms: null }
  );
  const executing = scrUrl ? scrRun.executing : masRun.executing;
  const error = scrUrl ? scrRun.error : masRun.error;
  const executionTime = scrUrl ? scrRun.ms : masRun.executionTime;
  const output = scrUrl ? null : masRun.output;
  const reset = useCallback(() => {
    if (scrUrl) setScrRun({ executing: false, error: null, ms: null });
    else masReset();
  }, [scrUrl, masReset]);

  // Stored fields compared with the step's current signature; only once the
  // step has loaded, or every field would look removed.
  const drift = useMemo(
    () => (step ? computeSignatureDrift(definition, step) : null),
    [definition, step]
  );

  const fieldErrors = useMemo(() => {
    if (blockedRuns > 0) return validateInputs(definition, step, inputValues);
    if (!stepCheck) return {};
    const ids = new Set(definition.layout.sections.find(s => s.id === stepCheck)?.fields.map(f => f.parameterId) ?? []);
    return Object.fromEntries(Object.entries(validateInputs(definition, step, inputValues)).filter(([k]) => ids.has(k)));
  }, [blockedRuns, stepCheck, definition, step, inputValues]);
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

  // Fill inputs from the link once the signature is known (for the types).
  // Only fills the form: the app never runs on its own.
  useEffect(() => {
    if (preview || prefilled !== null || !step) return;
    const types = Object.fromEntries((step.inputs ?? []).map(p => [p.name.toLowerCase(), p.type]));
    const { values, names } = prefillFromQuery(definition, location.search, types);
    setPrefilled(names);
    if (names.length > 0) setInputValues(prev => ({ ...prev, ...values }));
  }, [preview, prefilled, step, definition, location.search]);

  // Tabs or steps: once results arrive, show the first section with results.
  useEffect(() => {
    const display = definition.layout.display ?? 'page';
    if (display === 'page' || Object.keys(outputValues).length === 0) return;
    const at = shownSections(definition.layout).findIndex(s => s.fields.some(f => f.direction === 'output'));
    if (at >= 0) setActiveSection(at);
  }, [outputValues, definition.layout]);

  const handleExecute = useCallback(async () => {
    if (!step) return;
    const errors = validateInputs(definition, step, inputValues);
    if (Object.keys(errors).length > 0) {
      setBlockedRuns(n => n + 1);
      // Tabs or steps: show the first section holding a problem.
      const shown = shownSections(definition.layout);
      const at = shown.findIndex(s => s.fields.some(f => f.parameterId in errors));
      if (at >= 0) setActiveSection(at);
      return;
    }
    setBlockedRuns(0);
    setStepCheck(null);
    try {
      // Converted by the signature's types; fields whose parameter the step
      // no longer lists are left out, and step inputs without a field go out
      // as null (buildStepInput fills every step input).
      const values = buildRunValues(definition, step, inputValues);
      setLastRun({ inputs: values, at: new Date().toISOString() });
      if (scrUrl) {
        if (!scrInfo) return;
        // Every signature input goes out; one without a field as null.
        const data: Record<string, unknown> = {};
        for (const p of step.inputs) data[p.name] = values[p.name] ?? null;
        setScrRun({ executing: true, error: null, ms: null });
        setOutputValues({});
        try {
          const started = performance.now();
          const result = await scoreForApp(scrInfo, data);
          setOutputValues(result.outputs);
          recordRun({
            at: Date.now(),
            inputs: data,
            outputs: Object.entries(result.outputs).map(([name, value]) => ({ name, value })),
            latencyMs: performance.now() - started,
          });
          setScrRun({ executing: false, error: null, ms: result.elapsedMs });
        } catch (err) {
          setScrRun({ executing: false, error: err instanceof Error ? err.message : String(err), ms: null });
          recordRun({ at: Date.now(), inputs: data, outputs: null, latencyMs: 0, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      const started = performance.now();
      try {
        const result = await masExecute(step, values);
        recordRun({
          at: Date.now(),
          inputs: values,
          outputs: (result.outputs ?? []).map(o => ({ name: o.name, value: o.value })),
          executionState: result.executionState,
          latencyMs: performance.now() - started,
        });
      } catch (err) {
        recordRun({
          at: Date.now(),
          inputs: values,
          outputs: null,
          latencyMs: performance.now() - started,
          error: err instanceof Error ? err.message : 'Execution failed',
        });
        throw err;
      }
    } catch {
      // Error handled by hook
    }
  }, [step, definition, inputValues, masExecute, scrUrl, scrInfo, recordRun]);

  // Put a past run's inputs back in the form (sent values are keyed by the step's input names).
  const restoreRun = useCallback((run: RunRecord) => {
    const params = step?.inputs ?? [];
    const next: Record<string, unknown> = {};
    for (const section of definition.layout.sections) {
      for (const f of section.fields) {
        if (f.direction !== 'input') continue;
        const p = findParameter(params, f.parameterId);
        if (p && p.name in run.inputs) next[f.parameterId] = run.inputs[p.name];
      }
    }
    setInputValues(prev => ({ ...prev, ...next }));
  }, [step, definition.layout.sections]);

  const handleReset = useCallback(() => {
    setInputValues(getInitialInputValues(definition));
    setOutputValues({});
    setLastRun(null);
    setBlockedRuns(0);
    setStepCheck(null);
    setActiveSection(0);
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
          {scrUrl
            ? loadError
            : `${loadError}. The module "${definition.moduleId}" may have been removed from MAS.`}
        </Alert>
      </div>
    );
  }

  const title = definition.settings.title || definition.name;
  const submitLabel = definition.settings.submitLabel || 'Execute';
  const outputLayout = definition.settings.outputLayout || 'below';
  const submitPosition = getSubmitPosition(definition.settings);
  const modelInfo = !scrUrl && definition.settings.showModelInfo && module && modelIdOf(module)
    ? <ModelInfoPanel module={module} />
    : null;
  const historyPanel = definition.settings.runHistory && step ? (
    <RunHistory
      runs={history}
      inputParameters={step.inputs ?? []}
      outputParameters={step.outputs ?? []}
      onRestore={restoreRun}
      onClear={clearHistory}
      disabled={executing}
    />
  ) : null;
  const batch = definition.settings.batchFromFile
    ? <BatchFromFile definition={definition} step={step} scrInfo={scrUrl ? scrInfo : null} />
    : null;

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
                <Badge variant={scrUrl ? 'warning' : 'info'}>{scrUrl ? 'SCR' : 'MAS'}</Badge>
                <Badge variant="default">{module?.name ?? definition.moduleId}</Badge>
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
      title={`This app's fields differ from the ${scrUrl ? "endpoint's" : "module's current step"} signature`}
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

  const prefillNote = prefilled && prefilled.length > 0 && (
    <Alert variant="info" title="Filled from the link">
      {nameList(prefilled)} {prefilled.length === 1 ? 'was' : 'were'} filled in from the link. Check the values, then run the app.
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
      style={accentButtonStyle(definition.settings)}
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
        {prefillNote}

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
                  submit={submitPosition === 'top' ? { node: executeButton, position: 'top' } : undefined}
                />
              </CardBody>
              {submitPosition !== 'top' && (
                <CardFooter>
                  {executeButton}
                </CardFooter>
              )}
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
                <RunMessages rules={definition.settings.messageRules} outputs={outputValues} />
                {!executing && <ResultDownloads definition={definition} run={lastRun} outputs={outputValues} />}
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

        {historyPanel}
        {batch}
        {modelInfo}
      </div>
    );
  }

  // Inline or below: single unified card. Tabs keep the run button under
  // the panels (or at the top); steps put it on the last step with inputs.
  const display = unifiedLayout.display ?? 'page';
  const shown = shownSections(unifiedLayout);
  const current = Math.min(activeSection, Math.max(shown.length - 1, 0));
  let runStep = -1;
  shown.forEach((s, i) => { if (s.fields.some(f => f.direction === 'input' && f.visible)) runStep = i; });
  if (runStep < 0) runStep = shown.length - 1;
  const formSubmit = display === 'steps'
    ? undefined
    : display === 'tabs'
      ? (submitPosition === 'top' ? { node: executeButton, position: 'top' as const } : undefined)
      : (submitPosition === 'bottom' ? undefined : { node: executeButton, position: submitPosition });
  const footerButton = display === 'page' ? submitPosition === 'bottom' : display === 'tabs' ? submitPosition !== 'top' : false;
  const goNext = () => {
    const section = shown[current];
    const ids = new Set(section.fields.map(f => f.parameterId));
    const problems = Object.keys(validateInputs(definition, step, inputValues)).filter(k => ids.has(k));
    if (problems.length > 0) {
      setStepCheck(section.id);
      return;
    }
    setStepCheck(null);
    setActiveSection(current + 1);
  };
  const stepNav = display === 'steps' && shown.length > 0 ? (
    <div className="ui-runner__steps-nav">
      {current > 0 && (
        <Button variant="secondary" onClick={() => { setStepCheck(null); setActiveSection(current - 1); }}>Back</Button>
      )}
      {current === runStep ? executeButton : current < shown.length - 1 && (
        <Button variant="primary" onClick={goNext}>Next</Button>
      )}
    </div>
  ) : null;

  return (
    <div className="ui-runner">
      {renderHeader()}

      {driftNotice}
        {prefillNote}

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
            submit={formSubmit}
            active={current}
            onActiveChange={setActiveSection}
            stepNav={stepNav}
          />
          <RunMessages rules={definition.settings.messageRules} outputs={outputValues} />
          {!executing && <ResultDownloads definition={definition} run={lastRun} outputs={outputValues} />}
        </CardBody>
        {footerButton && (
          <CardFooter>
            {executeButton}
          </CardFooter>
        )}
      </Card>

      {validationSummary}

      {error && (
        <Alert variant="error" title="Execution Error" dismissible onClose={reset}>
          {error}
        </Alert>
      )}

      {historyPanel}
        {batch}
      {modelInfo}
    </div>
  );
};
