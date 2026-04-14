// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UIDefinition } from '../../types/uiBuilder';
import { Step } from '../../types';
import { Card, CardHeader, CardBody, CardFooter } from '../common/Card';
import { Button } from '../common/Button';
import { Alert } from '../common/Alert';
import { Loading } from '../common/Loading';
import { Badge } from '../common/Badge';
import { PageHeader } from '../layout/Layout';
import { DynamicForm } from './DynamicForm';
import { useStepExecution, useSteps } from '../../hooks';
import { getModule } from '../../api/modules';
import { Module } from '../../types';

interface UIRunnerProps {
  definition: UIDefinition;
  onBack: () => void;
  onEdit: () => void;
  standalone?: boolean;
}

export const UIRunner: React.FC<UIRunnerProps> = ({ definition, onBack, onEdit, standalone = false }) => {
  const navigate = useNavigate();

  const handleOpenStandalone = useCallback(() => {
    navigate(`/ui-apps/${encodeURIComponent(definition.id)}?standalone=true`);
  }, [navigate, definition.id]);

  const handleExitStandalone = useCallback(() => {
    navigate(`/ui-apps/${encodeURIComponent(definition.id)}`);
  }, [navigate, definition.id]);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const section of definition.layout.sections) {
      for (const field of section.fields) {
        if (field.direction === 'input' && field.defaultValue !== undefined) {
          defaults[field.parameterId] = field.defaultValue;
        }
      }
    }
    return defaults;
  });

  const [outputValues, setOutputValues] = useState<Record<string, unknown>>({});
  const [module, setModule] = useState<Module | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { steps } = useSteps(definition.moduleId);

  // Load the module
  useEffect(() => {
    setLoading(true);
    getModule(definition.moduleId)
      .then(m => setModule(m))
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Failed to load module'))
      .finally(() => setLoading(false));
  }, [definition.moduleId]);

  // Find the step once steps are loaded
  useEffect(() => {
    if (steps.length > 0) {
      const found = steps.find(s => s.id === definition.stepId);
      if (found) setStep(found);
      else setLoadError(`Step "${definition.stepId}" not found in module`);
    }
  }, [steps, definition.stepId]);

  const { output, executing, error, executionTime, executeWithValues, reset } =
    useStepExecution(definition.moduleId, definition.stepId);

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
    try {
      await executeWithValues(step, inputValues);
    } catch {
      // Error handled by hook
    }
  }, [step, inputValues, executeWithValues]);

  const handleReset = useCallback(() => {
    // Re-initialize defaults (preserving hidden field defaults)
    const defaults: Record<string, unknown> = {};
    for (const section of definition.layout.sections) {
      for (const field of section.fields) {
        if (field.direction === 'input' && field.defaultValue !== undefined) {
          defaults[field.parameterId] = field.defaultValue;
        }
      }
    }
    setInputValues(defaults);
    setOutputValues({});
    reset();
  }, [reset, definition.layout.sections]);

  if (loading) {
    return <Loading message="Loading UI App..." />;
  }

  if (loadError) {
    return (
      <div className="ui-runner">
        <PageHeader
          title={definition.name}
          breadcrumbs={[{ label: 'UI Apps', onClick: onBack }, { label: definition.name }]}
        />
        <Alert variant="error" title="Failed to load">
          {loadError}. The module "{definition.moduleId}" may have been removed from MAS.
        </Alert>
      </div>
    );
  }

  const title = definition.settings.title || definition.name;
  const submitLabel = definition.settings.submitLabel || 'Execute';
  const outputLayout = definition.settings.outputLayout || 'below';

  // Separate input and output sections for side-by-side layout
  const hasInputFields = definition.layout.sections.some(s =>
    s.fields.some(f => f.direction === 'input' && f.visible)
  );
  const hasOutputFields = definition.layout.sections.some(s =>
    s.fields.some(f => f.direction === 'output' && f.visible)
  );

  // For side-by-side: build separate input-only and output-only layouts
  // Static fields go into the input side
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

  // Unified layout for inline/below modes
  const unifiedLayout = definition.layout;

  if (outputLayout === 'side-by-side') {
    return (
      <div className="ui-runner">
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
                {definition.settings.showExecutionTime && executionTime && (
                  <Badge variant="default">{executionTime.toFixed(0)}ms</Badge>
                )}
                <Badge variant="info">{module?.name ?? definition.moduleId}</Badge>
                <Button variant="tertiary" onClick={handleOpenStandalone}>Standalone</Button>
                <Button variant="secondary" onClick={onEdit}>Edit</Button>
                <Button variant="tertiary" onClick={onBack}>Back</Button>
              </div>
            }
          />
        )}

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
                />
              </CardBody>
              <CardFooter>
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleExecute}
                  loading={executing}
                  disabled={executing || !step}
                >
                  {executing ? 'Executing...' : submitLabel}
                </Button>
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
              <Badge variant="info">{module?.name ?? definition.moduleId}</Badge>
              <Button variant="tertiary" onClick={handleOpenStandalone}>Standalone</Button>
              <Button variant="secondary" onClick={onEdit}>Edit</Button>
              <Button variant="tertiary" onClick={onBack}>Back</Button>
            </div>
          }
        />
      )}

      <Card>
        <CardHeader
          actions={
            <div className="ui-runner__header-actions">
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
          />
        </CardBody>
        <CardFooter>
          <Button
            variant="primary"
            size="large"
            onClick={handleExecute}
            loading={executing}
            disabled={executing || !step}
          >
            {executing ? 'Executing...' : submitLabel}
          </Button>
        </CardFooter>
      </Card>

      {error && (
        <Alert variant="error" title="Execution Error" dismissible onClose={reset}>
          {error}
        </Alert>
      )}
    </div>
  );
};
