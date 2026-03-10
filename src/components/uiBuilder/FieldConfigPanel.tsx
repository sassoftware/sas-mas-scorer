// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIField, UISection, WidgetType, FieldOption } from '../../types/uiBuilder';
import { StepParameter } from '../../types';
import { getCompatibleWidgets, getDefaultWidget } from '../../utils/uiDefaults';
import { widgetLabels } from './widgetMap';
import { Button } from '../common/Button';

interface Props {
  field: UIField;
  parameter: StepParameter | null;
  /** All available step parameters (inputs + outputs) for re-mapping */
  allParameters: StepParameter[];
  /** Already-used parameter IDs in the definition (for showing which are taken) */
  usedParameterIds: Set<string>;
  /** All sections for the "Move to Section" dropdown */
  sections: UISection[];
  /** Current section ID this field belongs to */
  currentSectionId: string;
  onChange: (field: UIField) => void;
  onMoveToSection: (targetSectionId: string) => void;
  onClose: () => void;
}

export const FieldConfigPanel: React.FC<Props> = ({
  field,
  parameter,
  allParameters,
  usedParameterIds,
  sections,
  currentSectionId,
  onChange,
  onMoveToSection,
  onClose,
}) => {
  const compatibleWidgets = field.direction === 'static'
    ? ['markdown' as WidgetType]
    : parameter
      ? getCompatibleWidgets(parameter.type, field.direction)
      : Object.keys(widgetLabels) as WidgetType[];

  const handleChange = <K extends keyof UIField>(key: K, value: UIField[K]) => {
    onChange({ ...field, [key]: value });
  };

  const handleParameterMapping = (newParameterId: string) => {
    const newParam = allParameters.find(p => p.name === newParameterId);
    if (!newParam || field.direction === 'static') return;

    // Update the field: change parameterId, reset widget to default for the new type
    const newDirection = field.direction;
    const newWidget = getDefaultWidget(newParam.type, newDirection);

    onChange({
      ...field,
      parameterId: newParameterId,
      label: newParameterId, // default label to parameter name
      widget: compatibleWidgets.includes(field.widget) ? field.widget : newWidget,
    });
  };

  const handleDirectionChange = (newDirection: 'input' | 'output' | 'static') => {
    if (newDirection === field.direction) return;
    if (newDirection === 'static') return; // Can't switch to static via dropdown
    // When direction changes, reset widget to appropriate default
    const newWidget = parameter
      ? getDefaultWidget(parameter.type, newDirection)
      : field.widget;
    onChange({
      ...field,
      direction: newDirection,
      widget: newWidget,
    });
  };

  const handleAddOption = () => {
    const options = field.validation?.options ?? [];
    handleChange('validation', {
      ...field.validation,
      options: [...options, { label: '', value: '' }],
    });
  };

  const handleRemoveOption = (index: number) => {
    const options = [...(field.validation?.options ?? [])];
    options.splice(index, 1);
    handleChange('validation', { ...field.validation, options });
  };

  const handleOptionChange = (index: number, key: keyof FieldOption, val: string) => {
    const options = [...(field.validation?.options ?? [])];
    options[index] = { ...options[index], [key]: val };
    handleChange('validation', { ...field.validation, options });
  };

  const showOptions = field.widget === 'dropdown' || field.widget === 'radio';
  const showMinMax = field.widget === 'slider' || field.widget === 'number';

  return (
    <div className="ui-builder__config-panel">
      <div className="ui-builder__config-header">
        <h4>Configure: {field.label}</h4>
        <button className="ui-builder__config-close" onClick={onClose}>&times;</button>
      </div>

      <div className="ui-builder__config-body">
        {field.direction === 'static' ? (
          <>
            {/* === Markdown Content Section === */}
            <div className="ui-builder__config-section-title">Markdown Content</div>

            <div className="ui-builder__config-field">
              <label>Content</label>
              <textarea
                className="sas-input ui-builder__markdown-editor"
                rows={8}
                value={field.defaultValue !== undefined ? String(field.defaultValue) : ''}
                onChange={(e) => handleChange('defaultValue', e.target.value)}
                placeholder="Enter markdown text...&#10;&#10;# Heading&#10;**Bold** and *italic*&#10;![alt](image-url)&#10;[Link text](url)"
              />
              <span className="ui-builder__config-type-hint">
                Supports: # headings, **bold**, *italic*, [links](url), ![images](url), `code`
              </span>
            </div>
          </>
        ) : (
          <>
            {/* === Mapping Section === */}
            <div className="ui-builder__config-section-title">Parameter Mapping</div>

            <div className="ui-builder__config-field">
              <label>Direction</label>
              <select
                className="sas-input"
                value={field.direction}
                onChange={(e) => handleDirectionChange(e.target.value as 'input' | 'output')}
              >
                <option value="input">Input</option>
                <option value="output">Output</option>
              </select>
            </div>

            <div className="ui-builder__config-field">
              <label>Mapped Parameter</label>
              <select
                className="sas-input"
                value={field.parameterId}
                onChange={(e) => handleParameterMapping(e.target.value)}
              >
                {allParameters.map(p => {
                  const isUsed = usedParameterIds.has(p.name) && p.name !== field.parameterId;
                  return (
                    <option key={p.name} value={p.name} disabled={isUsed}>
                      {p.name} ({p.type}){isUsed ? ' — already used' : ''}
                    </option>
                  );
                })}
              </select>
              {parameter && (
                <span className="ui-builder__config-type-hint">
                  Type: {parameter.type}{parameter.size ? `, max ${parameter.size}` : ''}
                </span>
              )}
            </div>
          </>
        )}

        {/* === Placement Section === */}
        {sections.length > 1 && (
          <>
            <div className="ui-builder__config-section-title">Placement</div>

            <div className="ui-builder__config-field">
              <label>Section</label>
              <select
                className="sas-input"
                value={currentSectionId}
                onChange={(e) => onMoveToSection(e.target.value)}
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.title || '(untitled)'}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* === Appearance Section === */}
        <div className="ui-builder__config-section-title">Appearance</div>

        <div className="ui-builder__config-field">
          <label>Label</label>
          <input
            type="text"
            className="sas-input"
            value={field.label}
            onChange={(e) => handleChange('label', e.target.value)}
          />
        </div>

        <div className="ui-builder__config-field">
          <label>Description / Help Text</label>
          <input
            type="text"
            className="sas-input"
            value={field.description ?? ''}
            onChange={(e) => handleChange('description', e.target.value || undefined)}
          />
        </div>

        {field.direction !== 'static' && (
          <div className="ui-builder__config-field">
            <label>Widget Type</label>
            <select
              className="sas-input"
              value={field.widget}
              onChange={(e) => handleChange('widget', e.target.value as WidgetType)}
            >
              {compatibleWidgets.map(w => (
                <option key={w} value={w}>{widgetLabels[w]}</option>
              ))}
            </select>
          </div>
        )}

        <div className="ui-builder__config-field">
          <label>Width</label>
          <select
            className="sas-input"
            value={field.width}
            onChange={(e) => handleChange('width', e.target.value as UIField['width'])}
          >
            <option value="third">1/3</option>
            <option value="half">1/2</option>
            <option value="full">Full</option>
          </select>
        </div>

        <div className="ui-builder__config-field">
          <label>
            <input
              type="checkbox"
              checked={field.visible}
              onChange={(e) => handleChange('visible', e.target.checked)}
            />
            {' '}Visible
          </label>
          {!field.visible && field.direction === 'input' && (
            <span className="ui-builder__config-type-hint">
              Hidden inputs with a default value will be sent silently on every execution.
            </span>
          )}
          {!field.visible && field.direction === 'output' && (
            <span className="ui-builder__config-type-hint">
              This output will not be displayed in the results.
            </span>
          )}
        </div>

        {/* === Input-specific settings === */}
        {field.direction === 'input' && (
          <>
            <div className="ui-builder__config-section-title">Input Settings</div>

            <div className="ui-builder__config-field">
              <label>Placeholder</label>
              <input
                type="text"
                className="sas-input"
                value={field.placeholder ?? ''}
                onChange={(e) => handleChange('placeholder', e.target.value || undefined)}
              />
            </div>

            <div className="ui-builder__config-field">
              <label>Default Value</label>
              <input
                type="text"
                className="sas-input"
                value={field.defaultValue !== undefined ? String(field.defaultValue) : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') handleChange('defaultValue', undefined);
                  else if (!isNaN(Number(val))) handleChange('defaultValue', Number(val));
                  else handleChange('defaultValue', val);
                }}
              />
            </div>
          </>
        )}

        {/* === Validation === */}
        {(showMinMax || showOptions) && (
          <div className="ui-builder__config-section-title">Validation</div>
        )}

        {showMinMax && (
          <div className="ui-builder__config-row">
            <div className="ui-builder__config-field">
              <label>Min</label>
              <input
                type="number"
                className="sas-input"
                value={field.validation?.min ?? ''}
                onChange={(e) => handleChange('validation', {
                  ...field.validation,
                  min: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              />
            </div>
            <div className="ui-builder__config-field">
              <label>Max</label>
              <input
                type="number"
                className="sas-input"
                value={field.validation?.max ?? ''}
                onChange={(e) => handleChange('validation', {
                  ...field.validation,
                  max: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              />
            </div>
          </div>
        )}

        {showOptions && (
          <div className="ui-builder__config-field">
            <label>Options</label>
            {(field.validation?.options ?? []).map((opt, i) => (
              <div key={i} className="ui-builder__option-row">
                <input
                  type="text"
                  className="sas-input"
                  placeholder="Label"
                  value={opt.label}
                  onChange={(e) => handleOptionChange(i, 'label', e.target.value)}
                />
                <input
                  type="text"
                  className="sas-input"
                  placeholder="Value"
                  value={String(opt.value)}
                  onChange={(e) => handleOptionChange(i, 'value', e.target.value)}
                />
                <button
                  className="ui-builder__option-remove"
                  onClick={() => handleRemoveOption(i)}
                >&times;</button>
              </div>
            ))}
            <Button variant="tertiary" size="small" onClick={handleAddOption}>
              Add Option
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
