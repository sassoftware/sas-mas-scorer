// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useState } from 'react';
import { UIDefinition, UILayout, WidgetType } from '../../../types/uiBuilder';
import { Step, StepParameter } from '../../../types';
import { Button } from '../../common/Button';
import { findParameter } from '../../../utils/uiDefaults';
import { widgetLabels } from '../widgetMap';
import { FieldsPanel } from './FieldsPanel';
import { DropPlace, FormCanvas, Selection } from './FormCanvas';
import { Inspector } from './Inspector';
import { WidgetToolbar } from './WidgetToolbar';
import { DragPayload } from './dnd';
import {
  Direction,
  addParameterField,
  addSection,
  addTextBlock,
  findField,
  moveField,
  moveSection,
  nudgeField,
  parameterForWidget,
  removeField,
  removeSection,
  renameSection,
  updateField,
  widgetFits,
} from './canvasOps';

/**
 * An edit of the app. `label` names it for Undo ("Remove field Age"); edits
 * with the same `coalesceKey` in quick succession (typing a label) undo as one.
 */
export type CanvasChange = (definition: UIDefinition, label: string, coalesceKey?: string) => void;

interface Props {
  definition: UIDefinition;
  step: Step | null;
  /** "MAS module: x" / "SCR endpoint: url", under the app name. */
  source: string;
  onChange: CanvasChange;
  /** Bumped by the builder (after Undo) to drop a selection that may be stale. */
  selectionResetKey?: number;
  /** The layout the quick start's template applies; null when there is none. */
  templateLayout: UILayout | null;
  announce: (message: string) => void;
  /** The builder's bar (breadcrumb, Edit / Preview, Save), above the canvas. */
  topBar?: React.ReactNode;
  /** Save results and signature warnings, under the bar. */
  notices?: React.ReactNode;
}

/**
 * The canvas-first UI app builder: the signature on the left, the app as it
 * will look in the middle, a widget bar under it and the inspector on the
 * right. Everything the canvas does by dragging can also be done by clicking
 * and from the keyboard.
 */
export const CanvasEditor: React.FC<Props> = ({
  definition,
  step,
  source,
  onChange,
  selectionResetKey,
  templateLayout,
  announce,
  topBar,
  notices,
}) => {
  const [selection, setSelection] = useState<Selection>(null);
  const [dragging, setDragging] = useState(false);
  const params = step ? [...(step.inputs ?? []), ...(step.outputs ?? [])] : [];

  useEffect(() => {
    if (selectionResetKey) setSelection(null);
  }, [selectionResetKey]);

  // A drag that ends outside any drop target must not leave the hints on.
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', stop);
    };
  }, [dragging]);

  const selectedField = selection?.kind === 'field' ? findField(definition, selection.id) : null;

  const addParameter = useCallback((
    param: StepParameter,
    direction: Direction,
    place?: { sectionId: string; index?: number },
    widget?: WidgetType
  ) => {
    const { def, parameterId } = addParameterField(definition, param, direction, place, widget);
    onChange(def, `Add field ${param.name}`);
    setSelection({ kind: 'field', id: parameterId });
    announce(`Added ${param.name} to the page.`);
  }, [definition, onChange, announce]);

  const addTextBlockAt = (place?: { sectionId: string; index?: number }) => {
    const { def, parameterId } = addTextBlock(definition, place);
    onChange(def, 'Add text block');
    setSelection({ kind: 'field', id: parameterId });
    announce('Added a text block.');
  };

  const setWidget = (parameterId: string, widget: WidgetType) => {
    const loc = findField(definition, parameterId);
    if (!loc || loc.field.widget === widget) return;
    onChange(updateField(definition, parameterId, f => ({ ...f, widget })), `Show ${loc.field.label} as ${widgetLabels[widget]}`);
    announce(`${loc.field.label} now uses the ${widgetLabels[widget]} widget.`);
  };

  /** A widget dropped on empty canvas, or clicked with nothing it fits selected. */
  const addWithWidget = (widget: WidgetType, place?: { sectionId: string; index?: number }) => {
    if (widget === 'markdown') {
      addTextBlockAt(place);
      return;
    }
    const pick = parameterForWidget(definition, step, widget);
    if (!pick) {
      announce(`No input or result without a field can use the ${widgetLabels[widget]} widget.`);
      return;
    }
    addParameter(pick.param, pick.direction, place, widget);
  };

  const removeFieldWithNote = (parameterId: string) => {
    const loc = findField(definition, parameterId);
    if (!loc) return;
    onChange(
      removeField(definition, parameterId),
      loc.field.direction === 'static' ? 'Remove text block' : `Remove field ${loc.field.label}`
    );
    setSelection(null);
    announce(`Removed ${loc.field.label}. Undo (Ctrl+Z) brings it back.`);
  };

  const handleDrop = (payload: DragPayload, place: DropPlace, onField?: string) => {
    setDragging(false);
    const target = place === 'page' ? undefined : place;
    if (payload.kind === 'widget') {
      if (onField) {
        const loc = findField(definition, onField);
        const param = loc && loc.field.direction !== 'static' ? findParameter(params, loc.field.parameterId) ?? null : null;
        if (loc && widgetFits(payload.widget, loc.field, param)) {
          setWidget(onField, payload.widget);
          setSelection({ kind: 'field', id: onField });
        } else if (loc) {
          announce(`${loc.field.label} can't use the ${widgetLabels[payload.widget]} widget.`);
        }
        return;
      }
      addWithWidget(payload.widget, target);
      return;
    }
    if (payload.kind === 'param') {
      const list = payload.direction === 'input' ? step?.inputs : step?.outputs;
      const param = list?.find(p => p.name === payload.name);
      if (param) addParameter(param, payload.direction, target);
      return;
    }
    // An existing field moved.
    const sections = definition.layout.sections;
    const to = target ?? (sections.length ? { sectionId: sections[sections.length - 1].id } : null);
    if (!to || payload.parameterId === onField) return;
    const next = moveField(definition, payload.parameterId, to.sectionId, to.index);
    if (next !== definition) {
      const loc = findField(definition, payload.parameterId);
      onChange(next, `Move ${loc?.field.label ?? 'field'}`);
      setSelection({ kind: 'field', id: payload.parameterId });
    }
  };

  const describeTile = (widget: WidgetType): { action: string; disabled: boolean } => {
    if (selectedField) {
      const param = selectedField.field.direction !== 'static'
        ? findParameter(params, selectedField.field.parameterId) ?? null
        : null;
      if (widgetFits(widget, selectedField.field, param)) {
        return { action: `show ${selectedField.field.label} with it`, disabled: false };
      }
    }
    if (widget === 'markdown') return { action: 'add a text block', disabled: false };
    const pick = parameterForWidget(definition, step, widget);
    return pick
      ? { action: `add ${pick.param.name} with it`, disabled: false }
      : { action: 'no field left that can use it', disabled: true };
  };

  const activateTile = (widget: WidgetType) => {
    if (selectedField) {
      const param = selectedField.field.direction !== 'static'
        ? findParameter(params, selectedField.field.parameterId) ?? null
        : null;
      if (widgetFits(widget, selectedField.field, param)) {
        setWidget(selectedField.field.parameterId, widget);
        return;
      }
    }
    addWithWidget(widget);
  };

  const applyTemplate = () => {
    if (!templateLayout) return;
    onChange({ ...definition, layout: { ...templateLayout, columns: definition.layout.columns } }, 'Start from template');
    setSelection(null);
    announce('Added every input and result to the page.');
  };

  return (
    <div className="cb">
      <FieldsPanel
        definition={definition}
        step={step}
        source={source}
        selectedFieldId={selection?.kind === 'field' ? selection.id : null}
        onSelectField={(id) => setSelection({ kind: 'field', id })}
        onAddParameter={(p, d) => addParameter(p, d)}
        onDragStateChange={setDragging}
      />

      <div className="cb-center">
        {topBar}
        {notices && <div className="cb-notices">{notices}</div>}
        <FormCanvas
          definition={definition}
          step={step}
          selection={selection}
          dragging={dragging}
          onSelect={setSelection}
          onDrop={handleDrop}
          onRemoveField={removeFieldWithNote}
          onDragStateChange={setDragging}
          templateControl={
            <Button variant="primary" size="small" onClick={applyTemplate} disabled={!templateLayout}>
              Use template
            </Button>
          }
        />
        <WidgetToolbar describe={describeTile} onActivate={activateTile} onDragStateChange={setDragging} />
      </div>

      <Inspector
        definition={definition}
        step={step}
        selection={selection}
        onSelect={setSelection}
        onFieldChange={(id, field) => {
          const before = findField(definition, id)?.field;
          const remapped = !!before && before.parameterId !== field.parameterId;
          onChange(
            updateField(definition, id, () => field),
            remapped ? `Remap ${before?.label ?? 'field'}` : `Edit ${field.label}`,
            remapped ? undefined : `field:${id}`
          );
          if (remapped) setSelection({ kind: 'field', id: field.parameterId });
        }}
        onWidgetChange={setWidget}
        onMoveFieldToSection={(id, sectionId) => {
          const next = moveField(definition, id, sectionId);
          if (next !== definition) onChange(next, 'Move field to section');
        }}
        onNudgeField={(id, delta) => {
          const next = nudgeField(definition, id, delta);
          if (next !== definition) onChange(next, 'Move field');
        }}
        onRemoveField={removeFieldWithNote}
        onNameChange={(name) => onChange({ ...definition, name }, 'Rename app', 'name')}
        onDescriptionChange={(d) => onChange({ ...definition, description: d || undefined }, 'Edit description', 'description')}
        onSettingsChange={(settings) => onChange({ ...definition, settings }, 'Change app settings', 'settings')}
        onColumnsChange={(columns) => onChange({ ...definition, layout: { ...definition.layout, columns } }, 'Change columns')}
        onSectionTitleChange={(id, title) => onChange(renameSection(definition, id, title), 'Rename section', `section-title:${id}`)}
        onMoveSection={(id, delta) => onChange(moveSection(definition, id, delta), 'Move section')}
        onRemoveSection={(id) => {
          onChange(removeSection(definition, id), 'Remove section');
          setSelection(null);
          announce('Removed the section. Undo (Ctrl+Z) brings it back.');
        }}
        onAddSection={() => {
          const { def, sectionId } = addSection(definition, 'New section');
          onChange(def, 'Add section');
          setSelection({ kind: 'section', id: sectionId });
        }}
      />
    </div>
  );
};
