// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { SubmitPosition, UIDefinition, UIField, UISection } from '../../../types/uiBuilder';
import { Step } from '../../../types';
import { WidgetRenderer } from '../../uiRunner/WidgetRenderer';
import { MarkdownWidget } from '../../uiRunner/widgets/MarkdownWidget';
import { accentButtonStyle, effectiveWidth, findParameter, getSubmitPosition, lastInputSectionId, safeColor } from '../../../utils/uiDefaults';
import { widgetLabels } from '../widgetMap';
import { DragPayload, isCanvasDrag, readDrag, startDrag } from './dnd';
import { fieldCount, orderedFields } from './canvasOps';

export type Selection =
  | { kind: 'field'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'app' }
  | null;

/** Where a drop lands: before a field, at the end of a section, or "somewhere on the page". */
export type DropPlace = { sectionId: string; index?: number } | 'page';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  selection: Selection;
  dragging: boolean;
  onSelect: (selection: Selection) => void;
  onDrop: (payload: DragPayload, place: DropPlace, onField?: string) => void;
  onRemoveField: (parameterId: string) => void;
  onDragStateChange: (dragging: boolean) => void;
  /** The run button was dropped at another position. */
  onMoveSubmit: (position: SubmitPosition) => void;
  /** Empty page: the quick start's template button. */
  templateControl: React.ReactNode;
}

const directionText = (f: UIField) => (f.direction === 'input' ? 'Input' : f.direction === 'output' ? 'Output' : 'Text');

export const GripIcon = () => (
  <svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
    <circle cx="2.5" cy="2.5" r="1.5" /><circle cx="7.5" cy="2.5" r="1.5" />
    <circle cx="2.5" cy="8" r="1.5" /><circle cx="7.5" cy="8" r="1.5" />
    <circle cx="2.5" cy="13.5" r="1.5" /><circle cx="7.5" cy="13.5" r="1.5" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const SUBMIT_PLACE_TEXT: Record<SubmitPosition, string> = {
  top: 'at the top',
  afterInputs: 'after the inputs',
  bottom: 'at the bottom',
};

/** Renders children without letting them take focus or clicks: a picture of the live control. */
const Inert: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // React 18 passes an unknown lowercase attribute through with a string value.
  <div className="cb-field__preview" {...({ inert: '' } as Record<string, string>)} aria-hidden="true">
    {children}
  </div>
);

export const FormCanvas: React.FC<Props> = ({
  definition,
  step,
  selection,
  dragging,
  onSelect,
  onDrop,
  onRemoveField,
  onDragStateChange,
  onMoveSubmit,
  templateControl,
}) => {
  // The drop target under the pointer, highlighted while dragging.
  const [over, setOver] = useState<string | null>(null);
  // The run button is being dragged: only its three places take a drop.
  const [movingSubmit, setMovingSubmit] = useState(false);
  const params = step ? [...(step.inputs ?? []), ...(step.outputs ?? [])] : [];
  const sections = definition.layout.sections;
  const columns = definition.layout.columns;
  const empty = fieldCount(definition) === 0;
  const paramTotal = params.length;
  const submitPosition = getSubmitPosition(definition.settings);
  const inputAnchor = lastInputSectionId(definition.layout);
  const submitLabel = definition.settings.submitLabel || 'Execute';
  const appSelected = selection?.kind === 'app';

  const dropHandlers = (key: string, place: DropPlace, onField?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isCanvasDrag(e) || movingSubmit) return;
      e.preventDefault();
      e.stopPropagation();
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === key) setOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      const payload = readDrag(e);
      if (!payload || payload.kind === 'submit') return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      onDragStateChange(false);
      onDrop(payload, place, onField);
    },
  });

  const endSubmitDrag = () => {
    setMovingSubmit(false);
    setOver(null);
    onDragStateChange(false);
  };

  /** A place the run button can be dropped, shown while it is dragged. */
  const submitSlot = (position: SubmitPosition) => {
    if (!movingSubmit || position === submitPosition) return null;
    const key = `submit:${position}`;
    return (
      <div
        className={`cb-submit-slot${over === key ? ' cb-submit-slot--over' : ''}`}
        onDragOver={(e) => {
          if (!isCanvasDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (over !== key) setOver(key);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === key) setOver(null);
        }}
        onDrop={(e) => {
          const payload = readDrag(e);
          if (payload?.kind !== 'submit') return;
          e.preventDefault();
          e.stopPropagation();
          endSubmitDrag();
          onMoveSubmit(position);
        }}
      >
        Move the run button here ({SUBMIT_PLACE_TEXT[position]})
      </div>
    );
  };

  const submitButton = (position: SubmitPosition) => {
    if (position !== submitPosition) return submitSlot(position);
    return (
      <div
        className={`cb-submit${appSelected ? ' cb-submit--selected' : ''}`}
        draggable
        onDragStart={(e) => {
          startDrag(e, { kind: 'submit' });
          setMovingSubmit(true);
          onDragStateChange(true);
        }}
        onDragEnd={endSubmitDrag}
      >
        <button
          type="button"
          className="cb-submit__select"
          aria-label={`Run button "${submitLabel}", ${SUBMIT_PLACE_TEXT[position]}: app settings`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ kind: 'app' });
          }}
        />
        <span className="cb-grip" aria-hidden="true"><GripIcon /></span>
        <span className="sas-button sas-button--primary sas-button--medium" aria-hidden="true" style={accentButtonStyle(definition.settings)}>{submitLabel}</span>
      </div>
    );
  };

  const renderField = (section: UISection, field: UIField, index: number) => {
    const selected = selection?.kind === 'field' && selection.id === field.parameterId;
    const param = field.direction === 'static' ? undefined : findParameter(params, field.parameterId);
    const missing = !!step && field.direction !== 'static' && !param;
    const key = `field:${field.parameterId}`;
    const value = field.direction === 'input' ? field.defaultValue ?? null : field.direction === 'static' ? field.defaultValue ?? null : null;
    const description = `${directionText(field)} · ${widgetLabels[field.widget]}${field.visible ? '' : ' · hidden'}${missing ? ' · not in the signature' : ''}`;

    return (
      <div
        key={field.parameterId}
        className={[
          'cb-field',
          `ui-runner__field--${effectiveWidth(field, columns)}`,
          selected ? 'cb-field--selected' : '',
          !field.visible ? 'cb-field--hidden' : '',
          missing ? 'cb-field--missing' : '',
          over === key ? 'cb-field--drop' : '',
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={(e) => {
          startDrag(e, { kind: 'field', parameterId: field.parameterId });
          onDragStateChange(true);
        }}
        onDragEnd={() => onDragStateChange(false)}
        {...dropHandlers(key, { sectionId: section.id, index }, field.parameterId)}
      >
        <button
          type="button"
          className="cb-field__select"
          aria-pressed={selected}
          aria-label={`${field.label}: ${description}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ kind: 'field', id: field.parameterId });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              onRemoveField(field.parameterId);
            }
          }}
        />
        <span className="cb-grip cb-field__grip" aria-hidden="true"><GripIcon /></span>
        {/* Keyboard users remove with Delete on the field, or Remove in the
            inspector, so this mouse shortcut stays out of the tab order. */}
        <button
          type="button"
          className="cb-field__remove"
          tabIndex={-1}
          aria-label={`Remove ${field.label}`}
          title={`Remove ${field.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveField(field.parameterId);
          }}
        >
          <CloseIcon />
        </button>
        {field.widget !== 'markdown' && field.widget !== 'hidden' && (
          <span className="cb-field__label">
            {field.label}
            {field.direction === 'input' && field.validation?.required && <span className="ui-runner__field-required">*</span>}
          </span>
        )}
        {field.widget === 'markdown' ? (
          <Inert><MarkdownWidget content={String(field.defaultValue ?? '')} /></Inert>
        ) : field.widget === 'hidden' ? (
          <span className="cb-field__hidden-note">{field.label} · hidden{field.direction === 'input' ? ', sent with its default' : ''}</span>
        ) : field.widget === 'table' ? (
          <div className="cb-field__table-ghost">
            <span>Rows appear here after a run</span>
          </div>
        ) : (
          <Inert>
            <WidgetRenderer field={field} value={value} disabled={field.direction !== 'input'} parameter={param} />
          </Inert>
        )}
        <span className="cb-field__meta" aria-hidden="true">
          {directionText(field)} · {widgetLabels[field.widget]}
          {missing && ' · not in the signature'}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`cb-canvas${dragging ? ' cb-canvas--dragging' : ''}`}
      onClick={() => onSelect(null)}
    >
      <div className="cb-page" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`cb-page__title${appSelected ? ' cb-page__title--selected' : ''}`}
          aria-pressed={appSelected}
          aria-label={`${definition.name}: app settings`}
          onClick={() => onSelect({ kind: 'app' })}
        >
          <span className="cb-page__name">{definition.name || 'Untitled app'}</span>
          {definition.description && <span className="cb-page__description">{definition.description}</span>}
        </button>

        {empty && (
          <div className="cb-quickstart">
            <div className="cb-quickstart__template">
              <div>
                <span className="cb-quickstart__eyebrow">Empty page</span>
                <strong className="cb-quickstart__title">Put every field back</strong>
                <span className="cb-quickstart__text">Adds every input and result again, in an Inputs and a Results section.</span>
              </div>
              {templateControl}
            </div>
            <div className="cb-quickstart__fields">
              <strong>
                {step ? `${paramTotal} field${paramTotal === 1 ? '' : 's'} found on this ${definition.scrUrl ? 'endpoint' : 'module'}` : 'Reading the signature…'}
              </strong>
              <span>Or add them one at a time from the app structure on the left.</span>
            </div>
          </div>
        )}

        {submitButton('top')}

        {sections.map(section => {
          const fields = orderedFields(section);
          const sectionSelected = selection?.kind === 'section' && selection.id === section.id;
          const endKey = `end:${section.id}`;
          return (
            <React.Fragment key={section.id}>
              <section
                className={`cb-section${sectionSelected ? ' cb-section--selected' : ''}${safeColor(section.color) ? ' ui-runner__section--colored' : ''}`}
                style={safeColor(section.color) ? ({ '--section-color': section.color } as React.CSSProperties) : undefined}
                aria-label={section.title || 'Untitled section'}
              >
                <button
                  type="button"
                  className="cb-section__title"
                  aria-pressed={sectionSelected}
                  aria-label={`Section ${section.title || '(untitled)'}: section settings`}
                  onClick={() => onSelect({ kind: 'section', id: section.id })}
                >
                  {section.title || <span className="cb-section__untitled">Untitled section</span>}
                </button>
                <div className={`ui-runner__fields ui-runner__fields--cols-${columns} cb-section__fields`}>
                  {fields.map((f, i) => renderField(section, f, i))}
                </div>
                <div
                  className={`cb-section__drop${over === endKey ? ' cb-section__drop--over' : ''}${fields.length === 0 ? ' cb-section__drop--empty' : ''}`}
                  {...dropHandlers(endKey, { sectionId: section.id })}
                >
                  {fields.length === 0 ? 'Empty section: drop a field here, or add one from the left' : 'Drop here to add to this section'}
                </div>
              </section>
              {section.id === inputAnchor && submitButton('afterInputs')}
            </React.Fragment>
          );
        })}

        {!inputAnchor && submitPosition === 'afterInputs' && submitButton('afterInputs')}
        {submitButton('bottom')}

        {definition.settings.showModelInfo && !definition.scrUrl && (
          <div className="cb-model-info" aria-hidden="true">
            <strong>Model information</strong>
            <span>Read from SAS Model Manager when the app opens: model, project, version, role, algorithm and target.</span>
          </div>
        )}

        {dragging && !movingSubmit && (
          <div
            className={`cb-page__drop${over === 'page' ? ' cb-page__drop--over' : ''}`}
            {...dropHandlers('page', 'page')}
          >
            Drop here to add it to the page
          </div>
        )}
      </div>
    </div>
  );
};
