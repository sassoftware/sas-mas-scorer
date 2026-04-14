// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect } from 'react';
import { Module, Step, StepParameter, getModuleType } from '../../types';
import { UIDefinition, UIField } from '../../types/uiBuilder';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { Badge } from '../common/Badge';
import { getModules, getModule } from '../../api/modules';
import { getSteps } from '../../api/steps';
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

  // New module/step state
  const [newModule, setNewModule] = useState<Module | null>(null);
  const [newStep, setNewStep] = useState<Step | null>(null);
  const [loadingStep, setLoadingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Mapping state
  const [mappings, setMappings] = useState<ParameterMapping[]>([]);

  // Load all modules
  useEffect(() => {
    const load = async () => {
      setLoadingModules(true);
      try {
        // Fetch all modules via pagination
        const allModules: Module[] = [];
        let start = 0;
        const limit = 100;
        let hasMore = true;
        while (hasMore) {
          const result = await getModules({ start, limit });
          allModules.push(...result.items);
          hasMore = result.items.length === limit;
          start += limit;
        }
        setModules(allModules);
      } catch {
        setModules([]);
      } finally {
        setLoadingModules(false);
      }
    };
    load();
  }, []);

  // When a module is selected, load its step
  const handleModuleSelect = async (moduleId: string) => {
    setSelectedModuleId(moduleId);
    setStepError(null);
    setLoadingStep(true);
    try {
      const mod = await getModule(moduleId);
      const stepsResult = await getSteps(moduleId);
      const scoreable = getScoreableStep(mod, stepsResult.items);
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
      setStepError(err instanceof Error ? err.message : 'Failed to load module');
      setNewModule(null);
      setNewStep(null);
    } finally {
      setLoadingStep(false);
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

  return (
    <div className="save-scenario-overlay" onClick={onClose}>
      <div
        className="save-scenario-dialog"
        style={{ width: dialogStep === 'map-parameters' ? '700px' : '560px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="save-scenario-dialog__header">
          <h3>
            {dialogStep === 'select-module' ? 'Replace Module' : 'Map Parameters'}
          </h3>
          <button className="save-scenario-dialog__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="save-scenario-dialog__body">
          {dialogStep === 'select-module' && (
            <>
              {currentModule && (
                <div className="replace-module__current">
                  <span className="save-scenario-dialog__label">Current Module</span>
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

              <div className="save-scenario-dialog__field">
                <label className="save-scenario-dialog__label">Select New Module</label>
                <div className="replace-module__search-row">
                  <input
                    type="text"
                    className="save-scenario-dialog__input"
                    style={{ flex: 1 }}
                    placeholder="Search modules..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                  />
                  <select
                    className="save-scenario-dialog__select"
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
                    <div className="replace-module__empty">No matching modules found</div>
                  ) : (
                    filteredModules.map(m => {
                      const mType = getModuleType(m);
                      return (
                        <button
                          key={m.id}
                          className={`replace-module__item ${selectedModuleId === m.id ? 'replace-module__item--selected' : ''}`}
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
                <div className="replace-module__error">{stepError}</div>
              )}

              {newStep && !loadingStep && (
                <div className="replace-module__step-info">
                  <span className="save-scenario-dialog__label">Scoreable Step</span>
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

              {/* Input mappings */}
              {mappings.filter(m => m.direction === 'input').length > 0 && (
                <div className="replace-module__mapping-section">
                  <h4 className="replace-module__mapping-title">Input Fields</h4>
                  <table className="replace-module__mapping-table">
                    <thead>
                      <tr>
                        <th>Current Field</th>
                        <th></th>
                        <th>New Parameter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.filter(m => m.direction === 'input').map((mapping, _i) => {
                        const globalIndex = mappings.indexOf(mapping);
                        const oldType = getOldParamType(mapping.oldParameterId, 'input');
                        const usedInputs = mappings
                          .filter(m => m.direction === 'input' && m.newParameterId && m !== mapping)
                          .map(m => m.newParameterId);
                        return (
                          <tr key={mapping.oldParameterId}>
                            <td>
                              <span className="replace-module__param-name">
                                {mapping.label}
                                {oldType && <span className="replace-module__param-type"> ({oldType})</span>}
                              </span>
                              {mapping.label !== mapping.oldParameterId && (
                                <span className="replace-module__param-id">{mapping.oldParameterId}</span>
                              )}
                            </td>
                            <td className="replace-module__arrow">→</td>
                            <td>
                              <select
                                className="save-scenario-dialog__select"
                                value={mapping.newParameterId}
                                onChange={(e) => handleMappingChange(globalIndex, e.target.value)}
                              >
                                <option value="">(unmapped — will be removed)</option>
                                {newStep.inputs.map(p => (
                                  <option
                                    key={p.name}
                                    value={p.name}
                                    disabled={usedInputs.includes(p.name)}
                                  >
                                    {p.name} ({p.type}{p.size ? `, ${p.size}` : ''})
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Output mappings */}
              {mappings.filter(m => m.direction === 'output').length > 0 && (
                <div className="replace-module__mapping-section">
                  <h4 className="replace-module__mapping-title">Output Fields</h4>
                  <table className="replace-module__mapping-table">
                    <thead>
                      <tr>
                        <th>Current Field</th>
                        <th></th>
                        <th>New Parameter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.filter(m => m.direction === 'output').map((mapping, _i) => {
                        const globalIndex = mappings.indexOf(mapping);
                        const oldType = getOldParamType(mapping.oldParameterId, 'output');
                        const usedOutputs = mappings
                          .filter(m => m.direction === 'output' && m.newParameterId && m !== mapping)
                          .map(m => m.newParameterId);
                        return (
                          <tr key={mapping.oldParameterId}>
                            <td>
                              <span className="replace-module__param-name">
                                {mapping.label}
                                {oldType && <span className="replace-module__param-type"> ({oldType})</span>}
                              </span>
                              {mapping.label !== mapping.oldParameterId && (
                                <span className="replace-module__param-id">{mapping.oldParameterId}</span>
                              )}
                            </td>
                            <td className="replace-module__arrow">→</td>
                            <td>
                              <select
                                className="save-scenario-dialog__select"
                                value={mapping.newParameterId}
                                onChange={(e) => handleMappingChange(globalIndex, e.target.value)}
                              >
                                <option value="">(unmapped — will be removed)</option>
                                {newStep.outputs.map(p => (
                                  <option
                                    key={p.name}
                                    value={p.name}
                                    disabled={usedOutputs.includes(p.name)}
                                  >
                                    {p.name} ({p.type}{p.size ? `, ${p.size}` : ''})
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!allMapped && (
                <div className="replace-module__mapping-warn">
                  {mappedCount} of {mappings.length} fields mapped. Unmapped fields will be removed from the UI.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="replace-module__footer">
          {dialogStep === 'select-module' ? (
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
          )}
        </div>
      </div>
    </div>
  );
};
