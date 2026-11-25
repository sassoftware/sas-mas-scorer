// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useId } from 'react';
import { SubmitPosition, UIDefinition, UIField, UISettings, WidgetType } from '../../../types/uiBuilder';
import { Step } from '../../../types';
import { compatibleWidgetsFor, findParameter, getSubmitPosition } from '../../../utils/uiDefaults';
import { FieldConfigPanel } from '../FieldConfigPanel';
import { widgetLabels } from '../widgetMap';
import { Button } from '../../common/Button';
import { widgetIcons, widgetShortLabels } from './widgetIcons';
import { canNudge, findField } from './canvasOps';
import { Selection } from './FormCanvas';
import { startDrag } from './dnd';
import { ColorChoice } from './ColorChoice';
import { MessageRulesEditor } from './MessageRulesEditor';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  dateKinds: Record<string, 'date' | 'datetime' | 'checkbox'>;
  /** The module was published from SAS Model Manager (offers the model information panel). */
  isModelModule?: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onFieldChange: (parameterId: string, field: UIField) => void;
  onWidgetChange: (parameterId: string, widget: WidgetType) => void;
  /** A widget tile is being dragged onto the canvas. */
  onDragStateChange: (dragging: boolean) => void;
  onMoveFieldToSection: (parameterId: string, sectionId: string) => void;
  onNudgeField: (parameterId: string, delta: -1 | 1) => void;
  onRemoveField: (parameterId: string) => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onSettingsChange: (settings: UISettings) => void;
  onColumnsChange: (columns: 1 | 2 | 3) => void;
  onSectionTitleChange: (sectionId: string, title: string) => void;
  onSectionColorChange: (sectionId: string, color: string | undefined) => void;
  onMoveSection: (sectionId: string, delta: -1 | 1) => void;
  onRemoveSection: (sectionId: string) => void;
  onAddSection: () => void;
}

const directionText = (f: UIField) => (f.direction === 'input' ? 'Input' : f.direction === 'output' ? 'Output' : 'Text block');

export const Inspector: React.FC<Props> = (props) => {
  const { definition, step, selection } = props;
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const params = step ? [...(step.inputs ?? []), ...(step.outputs ?? [])] : [];

  if (selection?.kind === 'app') {
    const s = definition.settings;
    return (
      <aside className="cb-inspector" aria-label="App settings">
        <div className="cb-inspector__head">
          <span className="cb-inspector__eyebrow">Selected · app</span>
          <h2 className="cb-inspector__title">App settings</h2>
        </div>
        <div className="cb-inspector__body">
          <div className="ui-builder__config-field">
            <label htmlFor={fid('name')}>Name</label>
            <input id={fid('name')} className="sas-input" value={definition.name} onChange={(e) => props.onNameChange(e.target.value)} />
          </div>
          <div className="ui-builder__config-field">
            <label htmlFor={fid('desc')}>Description (optional)</label>
            <textarea
              id={fid('desc')}
              className="sas-input"
              rows={2}
              value={definition.description ?? ''}
              placeholder="A short description shown above the form"
              onChange={(e) => props.onDescriptionChange(e.target.value)}
            />
          </div>
          <div className="ui-builder__config-field">
            <span className="cb-inspector__label" id={fid('cols')}>Columns</span>
            <div className="cb-segmented" role="group" aria-labelledby={fid('cols')}>
              {[1, 2, 3].map(n => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={definition.layout.columns === n}
                  className={definition.layout.columns === n ? 'cb-segmented__on' : ''}
                  onClick={() => props.onColumnsChange(n as 1 | 2 | 3)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="ui-builder__config-field">
            <label htmlFor={fid('out')}>Results position</label>
            <select
              id={fid('out')}
              className="sas-input"
              value={s.outputLayout || 'below'}
              onChange={(e) => props.onSettingsChange({ ...s, outputLayout: e.target.value as UISettings['outputLayout'] })}
            >
              <option value="below">Below the inputs</option>
              <option value="side-by-side">Side by side</option>
              <option value="inline">Inline</option>
            </select>
          </div>
          <div className="ui-builder__config-field">
            <label htmlFor={fid('pos')}>Run button position</label>
            <select
              id={fid('pos')}
              className="sas-input"
              value={getSubmitPosition(s)}
              onChange={(e) => props.onSettingsChange({ ...s, submitPosition: e.target.value as SubmitPosition })}
            >
              <option value="top">At the top</option>
              <option value="afterInputs">After the inputs</option>
              <option value="bottom">At the bottom</option>
            </select>
            <p className="ui-builder__config-type-hint">You can also drag the button on the canvas.</p>
          </div>
          {props.isModelModule && (
            <div className="ui-builder__config-field">
              <label>
                <input
                  type="checkbox"
                  checked={!!s.showModelInfo}
                  onChange={(e) => props.onSettingsChange({ ...s, showModelInfo: e.target.checked || undefined })}
                  aria-describedby={fid('modelinfo-hint')}
                />
                {' '}Show model information
              </label>
              <span className="ui-builder__config-type-hint" id={fid('modelinfo-hint')}>
                The model's name, project, version, role and algorithm from SAS Model Manager, read when the app opens. App users need read access to the model's project.
              </span>
            </div>
          )}
          <ColorChoice
            label="Run button colour"
            kind="button"
            value={s.accentColor}
            onChange={(color) => props.onSettingsChange({ ...s, accentColor: color })}
            hint="The button's text turns white or black, whichever is easier to read."
          />
          <div className="ui-builder__config-field">
            <label htmlFor={fid('btn')}>Button label</label>
            <input
              id={fid('btn')}
              className="sas-input"
              value={s.submitLabel ?? 'Execute'}
              onChange={(e) => props.onSettingsChange({ ...s, submitLabel: e.target.value })}
            />
          </div>
          <Button variant="secondary" size="small" onClick={props.onAddSection}>Add section</Button>

          <h3 className="cb-inspector__step">Messages after a run</h3>
          <p className="cb-inspector__hint">
            Show your own text when a result meets a condition, for example "Refer to underwriting" when the probability is above 0.7. Every matching message is shown, in this order. The app only compares what MAS returned with your value.
          </p>
          <MessageRulesEditor
            rules={s.messageRules ?? []}
            outputs={step?.outputs ?? []}
            onChange={(rules) => props.onSettingsChange({ ...s, messageRules: rules.length ? rules : undefined })}
          />
        </div>
      </aside>
    );
  }

  if (selection?.kind === 'section') {
    const index = definition.layout.sections.findIndex(s => s.id === selection.id);
    const section = definition.layout.sections[index];
    if (section) {
      return (
        <aside className="cb-inspector" aria-label="Section settings">
          <div className="cb-inspector__head">
            <span className="cb-inspector__eyebrow">Selected · section</span>
            <h2 className="cb-inspector__title">{section.title || 'Untitled section'}</h2>
            <span className="cb-inspector__sub">{section.fields.length} field{section.fields.length === 1 ? '' : 's'}</span>
          </div>
          <div className="cb-inspector__body">
            <div className="ui-builder__config-field">
              <label htmlFor={fid('stitle')}>Title</label>
              <input
                id={fid('stitle')}
                className="sas-input"
                value={section.title ?? ''}
                onChange={(e) => props.onSectionTitleChange(section.id, e.target.value)}
              />
            </div>
            <ColorChoice
              label="Colour line"
              kind="line"
              value={section.color}
              onChange={(color) => props.onSectionColorChange(section.id, color)}
              hint="A coloured line beside the section, to group or highlight it."
            />
            <div className="cb-inspector__row">
              <Button variant="secondary" size="small" disabled={index === 0} onClick={() => props.onMoveSection(section.id, -1)}>Move up</Button>
              <Button variant="secondary" size="small" disabled={index === definition.layout.sections.length - 1} onClick={() => props.onMoveSection(section.id, 1)}>Move down</Button>
            </div>
            <div className="cb-inspector__row">
              <Button variant="secondary" size="small" onClick={props.onAddSection}>Add section</Button>
              <Button variant="danger" size="small" onClick={() => props.onRemoveSection(section.id)}>Remove section</Button>
            </div>
            <p className="ui-builder__config-type-hint">Removing a section removes its fields too. Undo brings them back.</p>
          </div>
        </aside>
      );
    }
  }

  const location = selection?.kind === 'field' ? findField(definition, selection.id) : null;
  if (!location) {
    return (
      <aside className="cb-inspector cb-inspector--empty" aria-label="Inspector">
        <div className="cb-inspector__none">
          <span className="cb-inspector__none-icon" aria-hidden="true" />
          <h2 className="cb-inspector__title">No field selected</h2>
          <p>Click a field on the canvas or in the structure on the left to choose its widget and settings here.</p>
          <Button variant="tertiary" size="small" onClick={() => props.onSelect({ kind: 'app' })}>App settings</Button>
        </div>
      </aside>
    );
  }

  const field = location.field;
  const param = field.direction === 'static' ? null : findParameter(params, field.parameterId) ?? null;
  const compatible: WidgetType[] = field.direction === 'static'
    ? ['markdown']
    : param
      ? compatibleWidgetsFor(param, field.direction, props.dateKinds[param.name.toLowerCase()])
      : (Object.keys(widgetLabels) as WidgetType[]);
  if (!compatible.includes(field.widget)) compatible.push(field.widget);
  const usedParameterIds = new Set(definition.layout.sections.flatMap(s => s.fields.map(f => f.parameterId)));

  return (
    <aside className="cb-inspector" aria-label={`Settings for ${field.label}`}>
      <div className="cb-inspector__head">
        <span className="cb-inspector__eyebrow">Selected · {field.direction === 'static' ? 'text block' : field.parameterId}</span>
        <h2 className="cb-inspector__title">{field.label}</h2>
        <span className="cb-inspector__sub">{directionText(field)} · {widgetLabels[field.widget]} widget</span>
      </div>
      <div className="cb-inspector__body">
        {field.direction !== 'static' && (
          <>
            <h3 className="cb-inspector__step" id={fid('step1')}>Step 1 · Choose a widget</h3>
            <p className="cb-inspector__hint">
              {param && props.dateKinds[param.name.toLowerCase()]
                ? `The decision declares this ${field.direction} as a ${props.dateKinds[param.name.toLowerCase()]}. `
                : ''}
              Widgets this {param ? param.type : ''} {field.direction} can use. Click one, or drag it onto another field on the canvas to use it there.
            </p>
            <div className="cb-widgets" role="radiogroup" aria-labelledby={fid('step1')}>
              {compatible.map(w => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={field.widget === w}
                  className={`cb-widgets__tile${field.widget === w ? ' cb-widgets__tile--on' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    startDrag(e, { kind: 'widget', widget: w });
                    props.onDragStateChange(true);
                  }}
                  onDragEnd={() => props.onDragStateChange(false)}
                  onClick={() => props.onWidgetChange(field.parameterId, w)}
                >
                  <span className="cb-widgets__icon">{widgetIcons[w]}</span>
                  <span className="cb-widgets__label">{widgetShortLabels[w]}</span>
                </button>
              ))}
            </div>
            <h3 className="cb-inspector__step">Step 2 · Fine-tune</h3>
          </>
        )}

        <FieldConfigPanel
          variant="inspector"
          field={field}
          parameter={param}
          allParameters={params}
          usedParameterIds={usedParameterIds}
          sections={definition.layout.sections}
          currentSectionId={location.sectionId}
          columns={definition.layout.columns}
          onChange={(f) => props.onFieldChange(field.parameterId, f)}
          onMoveToSection={(id) => props.onMoveFieldToSection(field.parameterId, id)}
          onClose={() => props.onSelect(null)}
        />

        <div className="ui-builder__config-section-title">Placement</div>
        {definition.layout.sections.length > 1 && (
          <div className="ui-builder__config-field">
            <label htmlFor={fid('section')}>Section</label>
            <select
              id={fid('section')}
              className="sas-input"
              value={location.sectionId}
              onChange={(e) => props.onMoveFieldToSection(field.parameterId, e.target.value)}
            >
              {definition.layout.sections.map(s => (
                <option key={s.id} value={s.id}>{s.title || '(untitled)'}</option>
              ))}
            </select>
          </div>
        )}
        <div className="cb-inspector__row">
          <Button variant="secondary" size="small" disabled={!canNudge(definition, field.parameterId, -1)} onClick={() => props.onNudgeField(field.parameterId, -1)}>Move up</Button>
          <Button variant="secondary" size="small" disabled={!canNudge(definition, field.parameterId, 1)} onClick={() => props.onNudgeField(field.parameterId, 1)}>Move down</Button>
          <Button variant="danger" size="small" onClick={() => props.onRemoveField(field.parameterId)}>Remove</Button>
        </div>
        <p className="ui-builder__config-type-hint">Fields can also be dragged on the canvas. Delete removes the selected field; Undo brings it back.</p>
      </div>
    </aside>
  );
};
