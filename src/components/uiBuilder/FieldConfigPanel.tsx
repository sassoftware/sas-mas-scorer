// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId } from 'react';
import { UIField, UISection, WidgetType, FieldOption, ValueMapping, GaugeColorStop } from '../../types/uiBuilder';
import { StepParameter } from '../../types';
import {
  coerceConfigValue,
  getCompatibleWidgets,
  getDefaultToggleValues,
  getDefaultWidget,
  isNumericType,
} from '../../utils/uiDefaults';
import { widgetLabels } from './widgetMap';
import { Button } from '../common/Button';
import { IconButton } from '../common/IconButton';

/** Default colour for a new gauge stop: SAS brand blue (--sas-blue-primary). */
const DEFAULT_STOP_COLOR = '#0066B2';

const CloseIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 18L18 6M6 6l12 12" />
  </svg>
);

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
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const compatibleWidgets = field.direction === 'static'
    ? ['markdown' as WidgetType]
    : parameter
      ? getCompatibleWidgets(parameter.type, field.direction)
      : Object.keys(widgetLabels) as WidgetType[];
  // A saved app may use a widget the type no longer offers; keep it listed
  // so the select shows the truth rather than silently a different widget.
  if (!compatibleWidgets.includes(field.widget)) compatibleWidgets.push(field.widget);

  const handleChange = <K extends keyof UIField>(key: K, value: UIField[K]) => {
    onChange({ ...field, [key]: value });
  };

  const handleParameterMapping = (newParameterId: string) => {
    const newParam = allParameters.find(p => p.name === newParameterId);
    if (!newParam || field.direction === 'static') return;

    // Update the field: change parameterId; keep the widget only when the new
    // parameter's type supports it, else use that type's default.
    const newDirection = field.direction;
    const newWidget = getDefaultWidget(newParam.type, newDirection);

    onChange({
      ...field,
      parameterId: newParameterId,
      label: newParameterId, // default label to parameter name
      widget: getCompatibleWidgets(newParam.type, newDirection).includes(field.widget) ? field.widget : newWidget,
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
    // Stored by the parameter's type: a number for a numeric parameter, the
    // text as typed for a string ("007" stays "007").
    const coerced = key === 'value' && val !== '' ? coerceConfigValue(val, parameter?.type) : val;
    options[index] = { ...options[index], [key]: coerced };
    handleChange('validation', { ...field.validation, options });
  };

  const handleAddMapping = () => {
    const mappings = field.validation?.valueMappings ?? [];
    handleChange('validation', {
      ...field.validation,
      valueMappings: [...mappings, { from: '', to: '' }],
    });
  };

  const handleRemoveMapping = (index: number) => {
    const mappings = [...(field.validation?.valueMappings ?? [])];
    mappings.splice(index, 1);
    handleChange('validation', { ...field.validation, valueMappings: mappings });
  };

  const handleMappingChange = (index: number, key: keyof ValueMapping, val: string) => {
    const mappings = [...(field.validation?.valueMappings ?? [])];
    mappings[index] = { ...mappings[index], [key]: val };
    handleChange('validation', { ...field.validation, valueMappings: mappings });
  };

  const handleAddColorStop = () => {
    const stops = field.validation?.gaugeConfig?.colorStops ?? [];
    const config = field.validation?.gaugeConfig ?? { min: 0, max: 100, colorStops: [] };
    handleChange('validation', {
      ...field.validation,
      gaugeConfig: {
        ...config,
        colorStops: [...stops, { upTo: 100, color: DEFAULT_STOP_COLOR }],
      },
    });
  };

  const handleRemoveColorStop = (index: number) => {
    const config = field.validation?.gaugeConfig;
    if (!config) return;
    const stops = [...config.colorStops];
    stops.splice(index, 1);
    handleChange('validation', {
      ...field.validation,
      gaugeConfig: { ...config, colorStops: stops },
    });
  };

  const handleColorStopChange = (index: number, key: keyof GaugeColorStop, val: string) => {
    const config = field.validation?.gaugeConfig;
    if (!config) return;
    const stops = [...config.colorStops];
    stops[index] = { ...stops[index], [key]: key === 'upTo' ? Number(val) : val };
    handleChange('validation', {
      ...field.validation,
      gaugeConfig: { ...config, colorStops: stops },
    });
  };

  const isInput = field.direction === 'input';
  const showOptions = field.widget === 'dropdown' || field.widget === 'radio';
  const showMinMax = field.widget === 'slider' || field.widget === 'number';
  const showStep = field.widget === 'slider' || field.widget === 'number';
  const showRequired = isInput && field.widget !== 'hidden' && field.widget !== 'readonly';
  // Text limits apply to string parameters (or a field whose parameter is gone).
  const showMaxLength = isInput
    && (field.widget === 'text' || field.widget === 'textarea')
    && (!parameter || parameter.type === 'string');
  const showToggleValues = isInput && field.widget === 'toggle';
  const toggleDefaults = getDefaultToggleValues(parameter?.type);

  const setValidation = (patch: Partial<NonNullable<UIField['validation']>>) => {
    handleChange('validation', { ...field.validation, ...patch });
  };
  const showGaugeConfig = field.widget === 'gauge';
  const showOutputFormat = field.direction === 'output' && field.widget !== 'hidden';
  const showValueMappings = field.direction === 'output' && (field.widget === 'badge' || field.widget === 'readonly');

  return (
    <div className="ui-builder__config-panel">
      <div className="ui-builder__config-header">
        <h4>Configure: {field.label}</h4>
        <IconButton size="medium" onClick={onClose} title="Close" aria-label="Close configuration panel">
          <CloseIcon />
        </IconButton>
      </div>

      <div className="ui-builder__config-body">
        {field.direction === 'static' ? (
          <>
            {/* === Markdown Content Section === */}
            <div className="ui-builder__config-section-title">Markdown Content</div>

            <div className="ui-builder__config-field">
              <label htmlFor={fid('content')}>Content</label>
              <textarea
                id={fid('content')}
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
              <label htmlFor={fid('direction')}>Direction</label>
              <select
                id={fid('direction')}
                className="sas-input"
                value={field.direction}
                onChange={(e) => handleDirectionChange(e.target.value as 'input' | 'output')}
              >
                <option value="input">Input</option>
                <option value="output">Output</option>
              </select>
            </div>

            <div className="ui-builder__config-field">
              <label htmlFor={fid('param')}>Mapped Parameter</label>
              <select
                id={fid('param')}
                className="sas-input"
                value={field.parameterId}
                onChange={(e) => handleParameterMapping(e.target.value)}
              >
                {!parameter && (
                  // The stored parameter is not in the step signature (or the
                  // step has not loaded): show it rather than a wrong name.
                  <option value={field.parameterId}>{field.parameterId} (not in the step signature)</option>
                )}
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
              <label htmlFor={fid('section')}>Section</label>
              <select
                id={fid('section')}
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
          <label htmlFor={fid('label')}>Label</label>
          <input
            id={fid('label')}
            type="text"
            className="sas-input"
            value={field.label}
            onChange={(e) => handleChange('label', e.target.value)}
          />
        </div>

        <div className="ui-builder__config-field">
          <label htmlFor={fid('description')}>Description / Help Text</label>
          <input
            id={fid('description')}
            type="text"
            className="sas-input"
            value={field.description ?? ''}
            onChange={(e) => handleChange('description', e.target.value || undefined)}
          />
        </div>

        {field.direction !== 'static' && (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('widget')}>Widget Type</label>
            <select
              id={fid('widget')}
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
          <label htmlFor={fid('width')}>Width</label>
          <select
            id={fid('width')}
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
              <label htmlFor={fid('placeholder')}>Placeholder</label>
              <input
                id={fid('placeholder')}
                type="text"
                className="sas-input"
                value={field.placeholder ?? ''}
                onChange={(e) => handleChange('placeholder', e.target.value || undefined)}
              />
            </div>

            <div className="ui-builder__config-field">
              <label htmlFor={fid('default')}>Default Value</label>
              <input
                id={fid('default')}
                type="text"
                className="sas-input"
                aria-describedby={fid('default-hint')}
                value={field.defaultValue !== undefined
                  ? Array.isArray(field.defaultValue) ? field.defaultValue.join(', ') : String(field.defaultValue)
                  : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  handleChange('defaultValue', val === '' ? undefined : coerceConfigValue(val, parameter?.type));
                }}
              />
              <span className="ui-builder__config-type-hint" id={fid('default-hint')}>
                {parameter
                  ? isNumericType(parameter.type)
                    ? 'Stored as a number.'
                    : parameter.type.endsWith('Array')
                      ? 'Comma-separated; sent as an array.'
                      : 'Stored as text, exactly as typed.'
                  : 'Converted by the parameter type when the app runs.'}
              </span>
            </div>

            {showRequired && (
              <div className="ui-builder__config-field">
                <label>
                  <input
                    type="checkbox"
                    checked={!!field.validation?.required}
                    onChange={(e) => setValidation({ required: e.target.checked || undefined })}
                    aria-describedby={fid('required-hint')}
                  />
                  {' '}Required
                </label>
                <span className="ui-builder__config-type-hint" id={fid('required-hint')}>
                  The app will not run until this field has a value.
                </span>
              </div>
            )}

            {showToggleValues && (
              <div className="ui-builder__config-row">
                <div className="ui-builder__config-field">
                  <label htmlFor={fid('on')}>Value when on</label>
                  <input
                    id={fid('on')}
                    type="text"
                    className="sas-input"
                    value={field.validation?.onValue ?? ''}
                    placeholder={toggleDefaults.on}
                    onChange={(e) => setValidation({ onValue: e.target.value || undefined })}
                  />
                </div>
                <div className="ui-builder__config-field">
                  <label htmlFor={fid('off')}>Value when off</label>
                  <input
                    id={fid('off')}
                    type="text"
                    className="sas-input"
                    value={field.validation?.offValue ?? ''}
                    placeholder={toggleDefaults.off}
                    onChange={(e) => setValidation({ offValue: e.target.value || undefined })}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* === Validation === */}
        {(showMinMax || showOptions || showMaxLength) && (
          <div className="ui-builder__config-section-title">Validation</div>
        )}

        {showMaxLength && (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('maxlength')}>Max length</label>
            <input
              id={fid('maxlength')}
              type="number"
              className="sas-input"
              min="1"
              aria-describedby={fid('maxlength-hint')}
              value={field.validation?.maxLength ?? ''}
              placeholder={parameter?.size ? String(parameter.size) : 'No limit'}
              onChange={(e) => {
                const n = Number(e.target.value);
                setValidation({ maxLength: e.target.value === '' || !(n > 0) ? undefined : Math.floor(n) });
              }}
            />
            <span className="ui-builder__config-type-hint" id={fid('maxlength-hint')}>
              {parameter?.size
                ? `Empty uses the size the step signature declares (${parameter.size}).`
                : 'Checked before the app runs.'}
            </span>
          </div>
        )}

        {showMinMax && (
          <>
            <div className="ui-builder__config-row">
              <div className="ui-builder__config-field">
                <label htmlFor={fid('min')}>Min</label>
                <input
                  id={fid('min')}
                  type="number"
                  className="sas-input"
                  value={field.validation?.min ?? ''}
                  onChange={(e) => setValidation({
                    min: e.target.value === '' ? undefined : Number(e.target.value),
                  })}
                />
              </div>
              <div className="ui-builder__config-field">
                <label htmlFor={fid('max')}>Max</label>
                <input
                  id={fid('max')}
                  type="number"
                  className="sas-input"
                  value={field.validation?.max ?? ''}
                  onChange={(e) => setValidation({
                    max: e.target.value === '' ? undefined : Number(e.target.value),
                  })}
                />
              </div>
            </div>
            {field.validation?.min !== undefined && field.validation?.max !== undefined
              && field.validation.min > field.validation.max && (
              <span className="ui-builder__config-warning" role="status">
                Min is greater than Max, so no value can pass.
              </span>
            )}
            {showStep && (
              <div className="ui-builder__config-field">
                <label htmlFor={fid('step')}>Step Size</label>
                <input
                  id={fid('step')}
                  type="number"
                  className="sas-input"
                  min="0"
                  aria-describedby={fid('step-hint')}
                  value={field.validation?.step ?? ''}
                  placeholder="1"
                  onChange={(e) => setValidation({
                    step: e.target.value === '' ? undefined : Number(e.target.value),
                  })}
                />
                <span className="ui-builder__config-type-hint" id={fid('step-hint')}>
                  {field.widget === 'number'
                    ? 'Arrow Up / Down change the value by this much (e.g. 0.1, 1, 5)'
                    : 'Increment between values (e.g. 0.1, 1, 5)'}
                </span>
              </div>
            )}
          </>
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
                  aria-label={`Option ${i + 1} label`}
                  value={opt.label}
                  onChange={(e) => handleOptionChange(i, 'label', e.target.value)}
                />
                <input
                  type="text"
                  className="sas-input"
                  placeholder="Value"
                  aria-label={`Option ${i + 1} value`}
                  value={String(opt.value)}
                  onChange={(e) => handleOptionChange(i, 'value', e.target.value)}
                />
                <IconButton
                  size="small"
                  variant="danger"
                  onClick={() => handleRemoveOption(i)}
                  title="Remove option"
                  aria-label="Remove option"
                >
                  <CloseIcon />
                </IconButton>
              </div>
            ))}
            <Button variant="tertiary" size="small" onClick={handleAddOption}>
              Add Option
            </Button>
          </div>
        )}

        {/* === Output Formatting === */}
        {showOutputFormat && (
          <>
            <div className="ui-builder__config-section-title">Output Formatting</div>

            <div className="ui-builder__config-field">
              <label htmlFor={fid('decimals')}>Decimal Places</label>
              <input
                id={fid('decimals')}
                type="number"
                className="sas-input"
                min="0"
                max="10"
                value={field.validation?.decimals ?? ''}
                placeholder="Auto"
                onChange={(e) => handleChange('validation', {
                  ...field.validation,
                  decimals: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              />
              <span className="ui-builder__config-type-hint">
                Round numeric outputs to this many decimal places
              </span>
            </div>
          </>
        )}

        {/* === Value Mappings === */}
        {showValueMappings && (
          <>
            <div className="ui-builder__config-section-title">Value Mappings</div>
            <span className="ui-builder__config-type-hint" style={{ marginBottom: '8px', display: 'block' }}>
              Map raw output values to display labels (e.g. 0 → Yes, 1 → No)
            </span>

            {(field.validation?.valueMappings ?? []).map((mapping, i) => (
              <div key={i} className="ui-builder__option-row">
                <input
                  type="text"
                  className="sas-input"
                  placeholder="From value"
                  value={mapping.from}
                  onChange={(e) => handleMappingChange(i, 'from', e.target.value)}
                />
                <span className="ui-builder__mapping-arrow">→</span>
                <input
                  type="text"
                  className="sas-input"
                  placeholder="Display as"
                  value={mapping.to}
                  onChange={(e) => handleMappingChange(i, 'to', e.target.value)}
                />
                <IconButton
                  size="small"
                  variant="danger"
                  onClick={() => handleRemoveMapping(i)}
                  title="Remove mapping"
                  aria-label="Remove mapping"
                >
                  <CloseIcon />
                </IconButton>
              </div>
            ))}
            <Button variant="tertiary" size="small" onClick={handleAddMapping}>
              Add Mapping
            </Button>
          </>
        )}

        {/* === Gauge Configuration === */}
        {showGaugeConfig && (
          <>
            <div className="ui-builder__config-section-title">Gauge Settings</div>

            <div className="ui-builder__config-row">
              <div className="ui-builder__config-field">
                <label>Range Min</label>
                <input
                  type="number"
                  className="sas-input"
                  value={field.validation?.gaugeConfig?.min ?? 0}
                  onChange={(e) => handleChange('validation', {
                    ...field.validation,
                    gaugeConfig: {
                      min: Number(e.target.value),
                      max: field.validation?.gaugeConfig?.max ?? 100,
                      colorStops: field.validation?.gaugeConfig?.colorStops ?? [],
                    },
                  })}
                />
              </div>
              <div className="ui-builder__config-field">
                <label>Range Max</label>
                <input
                  type="number"
                  className="sas-input"
                  value={field.validation?.gaugeConfig?.max ?? 100}
                  onChange={(e) => handleChange('validation', {
                    ...field.validation,
                    gaugeConfig: {
                      min: field.validation?.gaugeConfig?.min ?? 0,
                      max: Number(e.target.value),
                      colorStops: field.validation?.gaugeConfig?.colorStops ?? [],
                    },
                  })}
                />
              </div>
            </div>

            <div className="ui-builder__config-field">
              <label>Color Stops</label>
              <span className="ui-builder__config-type-hint" style={{ marginBottom: '6px', display: 'block' }}>
                Define color changes at percentage thresholds (0-100%)
              </span>
              {(field.validation?.gaugeConfig?.colorStops ?? []).map((stop, i) => (
                <div key={i} className="ui-builder__option-row">
                  <input
                    type="number"
                    className="sas-input"
                    placeholder="Up to %"
                    min="0"
                    max="100"
                    value={stop.upTo}
                    onChange={(e) => handleColorStopChange(i, 'upTo', e.target.value)}
                  />
                  <input
                    type="color"
                    className="ui-builder__color-input"
                    value={stop.color.startsWith('#') ? stop.color : DEFAULT_STOP_COLOR}
                    onChange={(e) => handleColorStopChange(i, 'color', e.target.value)}
                    aria-label="Stop color"
                  />
                  <IconButton
                    size="small"
                    variant="danger"
                    onClick={() => handleRemoveColorStop(i)}
                    title="Remove color stop"
                    aria-label="Remove color stop"
                  >
                    <CloseIcon />
                  </IconButton>
                </div>
              ))}
              {(field.validation?.gaugeConfig?.colorStops ?? []).length === 0 && (
                <span className="ui-builder__config-type-hint">
                  No custom stops — using defaults: red ≤30%, yellow ≤70%, green ≤100%
                </span>
              )}
              <Button variant="tertiary" size="small" onClick={handleAddColorStop}>
                Add Color Stop
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
