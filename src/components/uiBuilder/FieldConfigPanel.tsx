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
  isDatagridType,
  isNumericType,
} from '../../utils/uiDefaults';
import { widgetLabels } from './widgetMap';
import { isoFromSasDate, isoFromSasDatetime, sasDateFromIso, sasDatetimeFromIso } from '../../utils/sasDate';
import { CURRENCIES, currencyOf } from '../../utils/numberFormat';
import { KPI_TONES } from '../uiRunner/widgets/KpiWidget';
import { KpiBand } from '../../types/uiBuilder';
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
  /**
   * 'inspector': the canvas-first builder's right panel, which shows the
   * widget choice and the placement itself, so this leaves out its own
   * header, the Widget Type select and the Placement section.
   */
  variant?: 'panel' | 'inspector';
  /** The app's column count: 1/3 is offered only with three columns. */
  columns?: 1 | 2 | 3;
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
  variant = 'panel',
  columns = 3,
}) => {
  const inInspector = variant === 'inspector';
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
    && (field.widget === 'text' || field.widget === 'textarea' || field.widget === 'file')
    && (!parameter || parameter.type === 'string');
  const showToggleValues = isInput && (field.widget === 'toggle' || field.widget === 'checkbox');
  const toggleDefaults = getDefaultToggleValues(parameter?.type);

  const setValidation = (patch: Partial<NonNullable<UIField['validation']>>) => {
    handleChange('validation', { ...field.validation, ...patch });
  };
  const showGaugeConfig = field.widget === 'gauge';
  const showOutputFormat = field.direction === 'output' && field.widget !== 'hidden';
  const showValueMappings = field.direction === 'output' && (field.widget === 'badge' || field.widget === 'readonly');

  return (
    <div className={inInspector ? 'ui-builder__config-panel ui-builder__config-panel--inspector' : 'ui-builder__config-panel'}>
      {!inInspector && (
        <div className="ui-builder__config-header">
          <h4>Configure: {field.label}</h4>
          <IconButton size="medium" onClick={onClose} title="Close" aria-label="Close configuration panel">
            <CloseIcon />
          </IconButton>
        </div>
      )}

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
        {!inInspector && sections.length > 1 && (
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

        {!inInspector && field.direction !== 'static' && (
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

        {field.widget === 'table' || field.widget === 'barchart' || columns === 1 ? (
          <p className="ui-builder__config-type-hint">
            {field.widget === 'table' || field.widget === 'barchart' ? 'Tables and charts always use the full width.' : 'With one column every field uses the full width.'}
          </p>
        ) : (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('width')}>Width</label>
            <select
              id={fid('width')}
              className="sas-input"
              value={field.width === 'third' && columns < 3 ? 'half' : field.width}
              onChange={(e) => handleChange('width', e.target.value as UIField['width'])}
            >
              {columns === 3 && <option value="third">1/3</option>}
              <option value="half">1/2</option>
              <option value="full">Full</option>
            </select>
          </div>
        )}

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

            {/* A file upload has no placeholder or default: the user always picks the file. */}
            {field.widget !== 'file' && (
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
            )}

            {field.widget === 'file' ? null : (field.widget === 'date' || field.widget === 'datetime') ? (
              <div className="ui-builder__config-field">
                <label htmlFor={fid('default')}>Default Value</label>
                <input
                  id={fid('default')}
                  type={field.widget === 'date' ? 'date' : 'datetime-local'}
                  step={field.widget === 'datetime' ? 1 : undefined}
                  className="sas-input"
                  aria-describedby={fid('default-hint')}
                  value={field.widget === 'date' ? isoFromSasDate(field.defaultValue) : isoFromSasDatetime(field.defaultValue)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const sas = !raw ? null : field.widget === 'date' ? sasDateFromIso(raw) : sasDatetimeFromIso(raw);
                    handleChange('defaultValue', sas === null ? undefined : sas);
                  }}
                />
                <span className="ui-builder__config-type-hint" id={fid('default-hint')}>
                  {field.defaultValue !== undefined && field.defaultValue !== null
                    ? `Stored as the SAS ${field.widget === 'date' ? 'date' : 'datetime'} value ${String(field.defaultValue)}.`
                    : `Stored as a SAS ${field.widget === 'date' ? 'date' : 'datetime'} value.`}
                </span>
              </div>
            ) : (
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
            )}

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

        {field.widget === 'barchart' && (
          <>
            <div className="ui-builder__config-section-title">Bar Chart</div>
            {parameter && isDatagridType(parameter.type) && (
              <div className="ui-builder__config-row">
                <div className="ui-builder__config-field">
                  <label htmlFor={fid('chartlabel')}>Label column</label>
                  <input id={fid('chartlabel')} className="sas-input" placeholder="First text column"
                    value={field.validation?.chartLabelColumn ?? ''}
                    onChange={(e) => setValidation({ chartLabelColumn: e.target.value || undefined })} />
                </div>
                <div className="ui-builder__config-field">
                  <label htmlFor={fid('chartvalue')}>Value column</label>
                  <input id={fid('chartvalue')} className="sas-input" placeholder="First number column"
                    value={field.validation?.chartValueColumn ?? ''}
                    onChange={(e) => setValidation({ chartValueColumn: e.target.value || undefined })} />
                </div>
              </div>
            )}
            <div className="ui-builder__config-row">
              <div className="ui-builder__config-field">
                <label htmlFor={fid('chartsort')}>Order</label>
                <select id={fid('chartsort')} className="sas-input" value={field.validation?.chartSort ?? ''}
                  onChange={(e) => setValidation({ chartSort: (e.target.value || undefined) as 'desc' | 'asc' | undefined })}>
                  <option value="">As returned</option>
                  <option value="desc">Largest first</option>
                  <option value="asc">Smallest first</option>
                </select>
              </div>
              <div className="ui-builder__config-field">
                <label htmlFor={fid('charttop')}>Show at most</label>
                <input id={fid('charttop')} type="number" min="1" className="sas-input" placeholder="50 bars"
                  value={field.validation?.chartTop ?? ''}
                  onChange={(e) => { const n = Number(e.target.value); setValidation({ chartTop: e.target.value === '' || !(n > 0) ? undefined : Math.floor(n) }); }} />
              </div>
            </div>
          </>
        )}

        {field.widget === 'kpi' && (
          <>
            <div className="ui-builder__config-section-title">KPI Tile</div>
            <div className="ui-builder__config-field">
              <label htmlFor={fid('unit')}>Unit</label>
              <input
                id={fid('unit')}
                className="sas-input"
                value={field.validation?.unit ?? ''}
                placeholder="For example ms, points, %"
                onChange={(e) => setValidation({ unit: e.target.value || undefined })}
              />
            </div>
            <div className="ui-builder__config-field">
              <span className="cb-inspector__label" id={fid('bands')}>Bands</span>
              <span className="ui-builder__config-type-hint" style={{ display: 'block', marginBottom: '6px' }}>
                Checked in order: the first band the value is below wins. Leave the last band's limit empty for everything above.
              </span>
              <div role="group" aria-labelledby={fid('bands')}>
                {(field.validation?.kpiBands ?? []).map((band, i, all) => {
                  const update = (patch: Partial<KpiBand>) =>
                    setValidation({ kpiBands: all.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
                  return (
                    <div key={i} className="ui-builder__option-row">
                      <input
                        type="number"
                        className="sas-input"
                        aria-label={`Band ${i + 1}: below`}
                        placeholder="Below (empty: any)"
                        value={band.below ?? ''}
                        onChange={(e) => update({ below: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                      <input
                        className="sas-input"
                        aria-label={`Band ${i + 1}: word shown`}
                        placeholder="Word, e.g. High"
                        value={band.label}
                        onChange={(e) => update({ label: e.target.value })}
                      />
                      <select
                        className="sas-input"
                        aria-label={`Band ${i + 1}: colour`}
                        value={band.tone}
                        onChange={(e) => update({ tone: e.target.value as KpiBand['tone'] })}
                      >
                        {(Object.keys(KPI_TONES) as KpiBand['tone'][]).map(t => (
                          <option key={t} value={t}>{KPI_TONES[t].name}</option>
                        ))}
                      </select>
                      <IconButton
                        size="small"
                        variant="danger"
                        onClick={() => setValidation({ kpiBands: all.filter((_b, j) => j !== i) })}
                        title="Remove band"
                        aria-label={`Remove band ${i + 1}`}
                      >
                        <CloseIcon />
                      </IconButton>
                    </div>
                  );
                })}
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setValidation({ kpiBands: [...(field.validation?.kpiBands ?? []), { label: '', tone: 'neutral' }] })}
              >
                Add band
              </Button>
            </div>
          </>
        )}

        {field.widget === 'percent' && (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('pscale')}>{isInput ? 'Send 12.5 % as' : 'The module returns 12.5 % as'}</label>
            <select
              id={fid('pscale')}
              className="sas-input"
              value={field.validation?.percentScale ?? 'fraction'}
              onChange={(e) => setValidation({ percentScale: e.target.value === 'points' ? 'points' : undefined })}
            >
              <option value="fraction">0.125 (a fraction)</option>
              <option value="points">12.5 (percentage points)</option>
            </select>
          </div>
        )}

        {field.widget === 'currency' && (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('currency')}>Currency</label>
            <select
              id={fid('currency')}
              className="sas-input"
              value={currencyOf(field)}
              onChange={(e) => setValidation({ currency: e.target.value })}
            >
              {(CURRENCIES.includes(currencyOf(field)) ? CURRENCIES : [currencyOf(field), ...CURRENCIES]).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="ui-builder__config-type-hint">Only shown with the amount; the module gets the plain number.</span>
          </div>
        )}

        {isInput && field.widget === 'file' && (
          <>
            <div className="ui-builder__config-field">
              <label htmlFor={fid('accept')}>File types</label>
              <select
                id={fid('accept')}
                className="sas-input"
                value={['', 'image/*', 'image/png,image/jpeg', 'application/pdf', '.csv,.txt,.json'].includes(field.validation?.fileAccept ?? '') ? (field.validation?.fileAccept ?? '') : 'custom'}
                onChange={(e) => setValidation({ fileAccept: e.target.value === 'custom' ? (field.validation?.fileAccept || '.') : e.target.value || undefined })}
              >
                <option value="">Any file</option>
                <option value="image/*">Images</option>
                <option value="image/png,image/jpeg">PNG and JPEG images</option>
                <option value="application/pdf">PDF documents</option>
                <option value=".csv,.txt,.json">Text files (CSV, TXT, JSON)</option>
                <option value="custom">Other (list them)</option>
              </select>
            </div>
            {!['', 'image/*', 'image/png,image/jpeg', 'application/pdf', '.csv,.txt,.json'].includes(field.validation?.fileAccept ?? '') && (
              <div className="ui-builder__config-field">
                <label htmlFor={fid('accept-list')}>Accepted extensions or types</label>
                <input
                  id={fid('accept-list')}
                  className="sas-input"
                  aria-describedby={fid('accept-hint')}
                  value={field.validation?.fileAccept ?? ''}
                  placeholder=".dcm,.tif"
                  onChange={(e) => setValidation({ fileAccept: e.target.value || undefined })}
                />
                <span className="ui-builder__config-type-hint" id={fid('accept-hint')}>Comma-separated, for example .dcm,.tif or image/webp.</span>
              </div>
            )}
            <div className="ui-builder__config-field">
              <label htmlFor={fid('fformat')}>Send the file as</label>
              <select
                id={fid('fformat')}
                className="sas-input"
                aria-describedby={fid('fformat-hint')}
                value={field.validation?.fileFormat ?? 'base64'}
                onChange={(e) => setValidation({ fileFormat: e.target.value === 'dataUrl' ? 'dataUrl' : undefined })}
              >
                <option value="base64">Base64 text only</option>
                <option value="dataUrl">Data URL (with the data:…;base64, prefix)</option>
              </select>
              <span className="ui-builder__config-type-hint" id={fid('fformat-hint')}>Choose what the module's code expects. Base64 is about a third larger than the file.</span>
            </div>
          </>
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
