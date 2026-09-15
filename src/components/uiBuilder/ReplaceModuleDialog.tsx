// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useRef } from 'react';
import { Module, Step, StepParameter, getModuleType } from '../../types';
import { UIDefinition, UIField } from '../../types/uiBuilder';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { Badge } from '../common/Badge';
import { Alert } from '../common/Alert';
import { Modal } from '../common/Modal';
import { EmptyState } from '../common/EmptyState';
import { getAllModules, getModule } from '../../api/modules';
import { getAllSteps } from '../../api/steps';
import { getScoreableStep } from '../../utils/moduleHelper';

type ModuleTypeFilter = 'All' | 'Model' | 'Decision';

interface Props {
  definition: UIDefinition;
  currentModule: Module | null;
  currentStep: Step | null;
  onReplace: (newDef: UIDefinition, newModule: Module, newStep: Step) => void;
  onClose: () => void;
}

type DialogStep = 'select-module' | 'map-parameters';

interface ParameterMapping {
  oldParameterId: string;
  direction: 'input' | 'output';
  label: string;
  newParameterId: string;
}

/** A mapping row together with its index in the full `mappings` array. */
interface IndexedMapping {
  mapping: ParameterMapping;
  index: number;
}

export const ReplaceModuleDialog: React.FC<Props> = ({
  definition,
  currentModule,
  currentStep,
  onReplace,
  onClose,
}) => {
  const [dialogStep, setDialogStep] = useState<DialogStep>('select-module');

  // Module selection state
  const [modules, setModules] = useState<Module[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<ModuleTypeFilter>('All');
  const [loadingModules, setLoadingModules] = useState(true);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // New module/step state
  const [newModule, setNewModule] = useState<Module | null>(null);
  const [newStep, setNewStep] = useState<Step | null>(null);
  const [loadingStep, setLoadingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  // Bumped on every module click; a response for an older click is dropped so
  // browsing quickly through modules cannot leave a stale step selected.
  const selectRequestRef = useRef(0);

  // Mapping state
  const [mappings, setMappings] = useState<ParameterMapping[]>([]);
  // Index (into `mappings`) of the parameter select that currently has focus.
  // Only that select renders the full parameter list; every other row carries
  // just the empty option and its own value, so a module with hundreds of
  // parameters does not mount hundreds of copies of the list.
  const [activeSelect, setActiveSelect] = useState<number | null>(null);

  // Load the complete module catalogue once per open; closing the dialog
  // discards whatever is still in flight.
  useEffect(() => {
    let cancelled = false;
    setLoadingModules(true);
    getAllModules()
      .then(all => { if (!cancelled) setModules(all); })
      .catch(() => { if (!cancelled) setModules([]); })
      .finally(() => { if (!cancelled) setLoadingModules(false); });
    return () => { cancelled = true; };
  }, []);

  // When a module is selected, load its scoreable step
  const handleModuleSelect = async (moduleId: string) => {
    const requestId = ++selectRequestRef.current;
    setSelectedModuleId(moduleId);
    setStepError(null);
    setLoadingStep(true);
    try {
      const [mod, steps] = await Promise.all([getModule(moduleId), getAllSteps(moduleId)]);
      if (requestId !== selectRequestRef.current) return;
      const scoreable = getScoreableStep(mod, steps);
      if (!scoreable) {
        setStepError('No scoreable step found in this module');
        setNewModule(null);
        setNewStep(null);
      } else {
        setNewModule(mod);
        setNewStep(scoreable);
        setStepError(null);
      }
    } catch (err) {
      if (requestId !== selectRequestRef.current) return;
      setStepError(err instanceof Error ? err.message : 'Failed to load module');
      setNewModule(null);
      setNewStep(null);
    } finally {
      if (requestId === selectRequestRef.current) setLoadingStep(false);
    }
  };

  // Build mappings when moving to the mapping step
  const handleProceedToMapping = () => {
    if (!newStep || !currentStep) return;

    // Collect all parameter fields from the current definition
    const paramFields: UIField[] = [];
    for (const section of definition.layout.sections) {
      for (const field of section.fields) {
        if (field.direction === 'input' || field.direction === 'output') {
          paramFields.push(field);
        }
      }
    }

    const newInputNames = newStep.inputs.map(p => p.name);
    const newOutputNames = newStep.outputs.map(p => p.name);

    const initialMappings: ParameterMapping[] = paramFields.map(field => {
      const newParams = field.direction === 'input' ? newInputNames : newOutputNames;
      // Auto-match by exact name (case-insensitive)
      const exactMatch = newParams.find(
        n => n.toLowerCase() === field.parameterId.toLowerCase()
      );
      return {
        oldParameterId: field.parameterId,
        direction: field.direction as 'input' | 'output',
        label: field.label,
        newParameterId: exactMatch ?? '',
      };
    });

    setMappings(initialMappings);
    setDialogStep('map-parameters');
  };

  const handleMappingChange = (index: number, newParameterId: string) => {
    setMappings(prev =>
      prev.map((m, i) => (i === index ? { ...m, newParameterId } : m))
    );
  };

  const handleApply = () => {
    if (!newModule || !newStep) return;

    // Build the updated definition
    const newSections = definition.layout.sections.map(section => ({
      ...section,
      fields: section.fields
        .map(field => {
          if (field.direction === 'static') return field;
          const mapping = mappings.find(m => m.oldParameterId === field.parameterId && m.direction === field.direction);
          if (!mapping || !mapping.newParameterId) return null; // Drop unmapped fields
          // Find the new parameter to get its type for widget compatibility
          const newParam = field.direction === 'input'
            ? newStep.inputs.find(p => p.name === mapping.newParameterId)
            : newStep.outputs.find(p => p.name === mapping.newParameterId);
          return {
            ...field,
            parameterId: mapping.newParameterId,
            label: field.label === mapping.oldParameterId ? mapping.newParameterId : field.label,
            // Reset validation if type changed
            validation: newParam && fieldTypeChanged(field, newParam, currentStep)
              ? undefined : field.validation,
          };
        })
        .filter((f): f is UIField => f !== null),
    }));

    const updatedDef: UIDefinition = {
      ...definition,
      moduleId: newModule.id,
      stepId: newStep.id,
      layout: {
        ...definition.layout,
        sections: newSections,
      },
    };

    onReplace(updatedDef, newModule, newStep);
  };

  // Check if the parameter type changed between old and new
  const fieldTypeChanged = (field: UIField, newParam: StepParameter, oldStep: Step | null): boolean => {
    if (!oldStep) return true;
    const oldParams = field.direction === 'input' ? oldStep.inputs : oldStep.outputs;
    const oldParam = oldParams.find(p => p.name === field.parameterId);
    return !oldParam || oldParam.type !== newParam.type;
  };

  const filteredModules = modules.filter(m => {
    if (m.id === definition.moduleId) return false; // Exclude current module
    if (typeFilter !== 'All' && getModuleType(m) !== typeFilter) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return m.name.toLowerCase().includes(term) || m.id.toLowerCase().includes(term);
  });

  // Look up the data type of an old parameter from the current step
  const getOldParamType = (parameterId: string, direction: 'input' | 'output'): string => {
    if (!currentStep) return '';
    const params = direction === 'input' ? currentStep.inputs : currentStep.outputs;
    const param = params.find(p => p.name === parameterId);
    return param ? param.type : '';
  };

  const allMapped = mappings.every(m => m.newParameterId !== '');
  const mappedCount = mappings.filter(m => m.newParameterId !== '').length;

  // Split the mappings by direction once per render, carrying the index into
  // `mappings` that handleMappingChange needs, and collect the parameters that
  // are already taken so each row can disable them without rescanning.
  const indexed: IndexedMapping[] = mappings.map((mapping, index) => ({ mapping, index }));
  const inputMappings = indexed.filter(x => x.mapping.direction === 'input');
  const outputMappings = indexed.filter(x => x.mapping.direction === 'output');
  const usedInputs = new Set(
    inputMappings.map(x => x.mapping.newParameterId).filter(id => id !== '')
  );
  const usedOutputs = new Set(
    outputMappings.map(x => x.mapping.newParameterId).filter(id => id !== '')
  );

  const optionLabel = (p: StepParameter) => `${p.name} (${p.type}${p.size ? `, ${p.size}` : ''})`;

  const renderMappingTable = (
    title: string,
    rows: IndexedMapping[],
    direction: 'input' | 'output',
    params: StepParameter[],
    used: Set<string>,
  ) => (
    <div className="replace-module__mapping-section">
      <h4 className="replace-module__mapping-title">{title}</h4>
      <div className="sas-table__wrapper">
        <table className="sas-table sas-table--compact replace-module__mapping-table">
          <thead className="sas-table__head">
            <tr>
              <th className="sas-table__th">Current Field</th>
              <th className="sas-table__th replace-module__arrow" aria-hidden="true"></th>
              <th className="sas-table__th">New Parameter</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ mapping, index }) => {
              const oldType = getOldParamType(mapping.oldParameterId, direction);
              const selected = mapping.newParameterId
                ? params.find(p => p.name === mapping.newParameterId)
                : undefined;
              return (
                <tr key={mapping.oldParameterId} className="sas-table__row">
                  <td className="sas-table__td">
                    <span className="replace-module__param-name">
                      {mapping.label}
                      {oldType && <span className="replace-module__param-type"> ({oldType})</span>}
                    </span>
                    {mapping.label !== mapping.oldParameterId && (
                      <span className="replace-module__param-id">{mapping.oldParameterId}</span>
                    )}
                  </td>
                  <td className="sas-table__td replace-module__arrow" aria-hidden="true">→</td>
                  <td className="sas-table__td">
                    <select
                      className="sas-input"
                      aria-label={`New parameter for ${mapping.label}`}
                      value={mapping.newParameterId}
                      onChange={(e) => handleMappingChange(index, e.target.value)}
                      onFocus={() => setActiveSelect(index)}
                      onBlur={() => setActiveSelect(null)}
                    >
                      <option value="">(unmapped — will be removed)</option>
                      {activeSelect === index ? (
                        params.map(p => (
                          <option
                            key={p.name}
                            value={p.name}
                            disabled={used.has(p.name) && p.name !== mapping.newParameterId}
                          >
                            {optionLabel(p)}
                          </option>
                        ))
                      ) : selected ? (
                        <option value={selected.name}>{optionLabel(selected)}</option>
                      ) : null}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const footer = dialogStep === 'select-module' ? (
    <>
      <Button variant="tertiary" onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        onClick={handleProceedToMapping}
        disabled={!newStep || loadingStep}
      >
        Next: Map Parameters
      </Button>
    </>
  ) : (
    <>
      <Button variant="tertiary" onClick={() => setDialogStep('select-module')}>Back</Button>
      <Button variant="primary" onClick={handleApply}>
        Apply ({mappedCount} of {mappings.length} mapped)
      </Button>
    </>
  );

  return (
    <Modal
      title={dialogStep === 'select-module' ? 'Replace Module' : 'Map Parameters'}
      onClose={onClose}
      size={dialogStep === 'map-parameters' ? 'large' : 'medium'}
      footer={footer}
      initialFocusRef={dialogStep === 'select-module' ? searchInputRef : undefined}
    >
      <div className="replace-module__body">
        {dialogStep === 'select-module' && (
          <>
            {currentModule && (
              <div className="replace-module__current">
                <span className="replace-module__label">Current Module</span>
                <div className="replace-module__current-info">
                  <strong>{currentModule.name}</strong>
                  <Badge variant={getModuleType(currentModule) === 'Decision' ? 'warning' : 'info'}>
                    {getModuleType(currentModule)}
                  </Badge>
                  <span className="replace-module__current-id">{currentModule.id}</span>
                  {currentStep && (
                    <Badge variant="info">{currentStep.id}</Badge>
                  )}
                </div>
              </div>
            )}

            <div className="replace-module__field">
              <label className="replace-module__label" htmlFor="replace-module-search">
                Select New Module
              </label>
              <div className="replace-module__search-row">
                <input
                  id="replace-module-search"
                  ref={searchInputRef}
                  type="text"
                  className="sas-input replace-module__search-input"
                  placeholder="Search modules..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                  className="sas-input"
                  aria-label="Module type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as ModuleTypeFilter)}
                >
                  <option value="All">All Types</option>
                  <option value="Model">Model</option>
                  <option value="Decision">Decision</option>
                </select>
              </div>
            </div>

            {loadingModules ? (
              <Loading message="Loading modules..." />
            ) : (
              <div className="replace-module__list">
                {filteredModules.length === 0 ? (
                  <EmptyState title="No matching modules found" icon={null} />
                ) : (
                  filteredModules.map(m => {
                    const mType = getModuleType(m);
                    const isSelected = selectedModuleId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`replace-module__item ${isSelected ? 'replace-module__item--selected' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => handleModuleSelect(m.id)}
                      >
                        <div className="replace-module__item-left">
                          <span className="replace-module__item-name">{m.name}</span>
                          <span className="replace-module__item-id">{m.id}</span>
                        </div>
                        <Badge variant={mType === 'Decision' ? 'warning' : mType === 'Model' ? 'info' : 'default'}>
                          {mType}
                        </Badge>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {loadingStep && <Loading message="Loading module step..." />}

            {stepError && (
              <Alert variant="error">{stepError}</Alert>
            )}

            {newStep && !loadingStep && (
              <div className="replace-module__step-info">
                <span className="replace-module__label">Scoreable Step</span>
                <div className="replace-module__step-params">
                  <Badge variant="info">{newStep.id}</Badge>
                  <span>{newStep.inputs.length} inputs, {newStep.outputs.length} outputs</span>
                </div>
              </div>
            )}
          </>
        )}

        {dialogStep === 'map-parameters' && newStep && (
          <>
            <p className="replace-module__mapping-info">
              Map each field from the current UI to a parameter in the new module.
              Unmapped fields will be removed.
            </p>

            {inputMappings.length > 0 &&
              renderMappingTable('Input Fields', inputMappings, 'input', newStep.inputs, usedInputs)}

            {outputMappings.length > 0 &&
              renderMappingTable('Output Fields', outputMappings, 'output', newStep.outputs, usedOutputs)}

            {!allMapped && (
              <Alert variant="warning">
                {mappedCount} of {mappings.length} fields mapped. Unmapped fields will be removed from the UI.
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
