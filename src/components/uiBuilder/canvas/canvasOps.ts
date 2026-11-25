// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Edits of a UI app definition for the canvas-first builder. Pure: each takes
 * a definition and returns a new one, so every edit goes through the
 * builder's undo stack the same way. Fields are identified by parameterId,
 * which is unique within a definition (text blocks get generated ids).
 */

import { UIDefinition, UIField, UISection, WidgetType } from '../../../types/uiBuilder';
import { Step, StepParameter } from '../../../types';
import { createFieldForParameter, getCompatibleWidgets } from '../../../utils/uiDefaults';

export type Direction = 'input' | 'output';

export interface FieldLocation {
  sectionId: string;
  index: number;
  field: UIField;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Fields kept in display order, with `order` matching their position. */
const renumber = (fields: UIField[]): UIField[] => fields.map((f, i) => (f.order === i ? f : { ...f, order: i }));

const withSections = (def: UIDefinition, sections: UISection[]): UIDefinition => ({
  ...def,
  layout: { ...def.layout, sections },
});

/** The section's fields in the order the runner shows them. */
export const orderedFields = (section: UISection): UIField[] => [...section.fields].sort((a, b) => a.order - b.order);

export function findField(def: UIDefinition, parameterId: string): FieldLocation | null {
  for (const section of def.layout.sections) {
    const fields = orderedFields(section);
    const index = fields.findIndex(f => f.parameterId === parameterId);
    if (index >= 0) return { sectionId: section.id, index, field: fields[index] };
  }
  return null;
}

/** Whether a step parameter already has a field (names compare case-insensitively, as MAS does). */
export function isPlaced(def: UIDefinition, name: string): boolean {
  return def.layout.sections.some(s => s.fields.some(f => f.direction !== 'static' && sameName(f.parameterId, name)));
}

/** Step parameters with no field on the page yet. */
export function unplacedParameters(def: UIDefinition, step: Step | null): { param: StepParameter; direction: Direction }[] {
  if (!step) return [];
  return [
    ...(step.inputs ?? []).map(param => ({ param, direction: 'input' as const })),
    ...(step.outputs ?? []).map(param => ({ param, direction: 'output' as const })),
  ].filter(p => !isPlaced(def, p.param.name));
}

export function fieldCount(def: UIDefinition): number {
  return def.layout.sections.reduce((n, s) => n + s.fields.length, 0);
}

/**
 * Where a new field of this direction goes when no place is given: the last
 * section that already holds fields of that direction, else a section named
 * like the direction, else the last section. Creates "Inputs" or "Results"
 * when there is no section at all.
 */
export function defaultSectionFor(def: UIDefinition, direction: Direction): { def: UIDefinition; sectionId: string } {
  const sections = def.layout.sections;
  const holding = [...sections].reverse().find(s => s.fields.some(f => f.direction === direction));
  if (holding) return { def, sectionId: holding.id };
  const wanted = direction === 'input' ? /^inputs?$/i : /^(results?|outputs?)$/i;
  const named = sections.find(s => wanted.test((s.title ?? '').trim()));
  if (named) return { def, sectionId: named.id };
  if (sections.length > 0 && direction === 'output' && sections.length === 1 && sections[0].fields.length > 0) {
    // One section of inputs only: results get their own section below it.
    return addSection(def, 'Results');
  }
  if (sections.length > 0) return { def, sectionId: sections[sections.length - 1].id };
  return addSection(def, direction === 'input' ? 'Inputs' : 'Results');
}

export function addSection(def: UIDefinition, title: string, atIndex?: number): { def: UIDefinition; sectionId: string } {
  const section: UISection = { id: newId(), title, fields: [] };
  const sections = [...def.layout.sections];
  sections.splice(atIndex ?? sections.length, 0, section);
  return { def: withSections(def, sections), sectionId: section.id };
}

/** Inserts a field into a section at a position (end when omitted). */
export function insertField(def: UIDefinition, field: UIField, sectionId: string, index?: number): UIDefinition {
  return withSections(
    def,
    def.layout.sections.map(s => {
      if (s.id !== sectionId) return s;
      const fields = orderedFields(s);
      fields.splice(index === undefined ? fields.length : Math.max(0, Math.min(index, fields.length)), 0, field);
      return { ...s, fields: renumber(fields) };
    })
  );
}

/** A new field for a step parameter, optionally with a chosen widget. */
export function addParameterField(
  def: UIDefinition,
  param: StepParameter,
  direction: Direction,
  place?: { sectionId: string; index?: number },
  widget?: WidgetType
): { def: UIDefinition; parameterId: string } {
  const field = createFieldForParameter(param, direction, 0);
  if (widget && getCompatibleWidgets(param.type, direction).includes(widget)) field.widget = widget;
  let next = def;
  let sectionId = place?.sectionId;
  if (!sectionId || !def.layout.sections.some(s => s.id === sectionId)) {
    const target = defaultSectionFor(def, direction);
    next = target.def;
    sectionId = target.sectionId;
  }
  return { def: insertField(next, field, sectionId, place?.index), parameterId: field.parameterId };
}

export function addTextBlock(def: UIDefinition, place?: { sectionId: string; index?: number }): { def: UIDefinition; parameterId: string } {
  const field: UIField = {
    parameterId: `text-${newId()}`,
    direction: 'static',
    label: 'Text Block',
    widget: 'markdown',
    visible: true,
    order: 0,
    defaultValue: '**Hello!** Enter your markdown here.',
    width: 'full',
  };
  let next = def;
  let sectionId = place?.sectionId;
  if (!sectionId || !def.layout.sections.some(s => s.id === sectionId)) {
    if (def.layout.sections.length === 0) {
      const created = addSection(def, 'Inputs');
      next = created.def;
      sectionId = created.sectionId;
    } else {
      sectionId = def.layout.sections[def.layout.sections.length - 1].id;
    }
  }
  return { def: insertField(next, field, sectionId, place?.index), parameterId: field.parameterId };
}

export function updateField(def: UIDefinition, parameterId: string, update: (f: UIField) => UIField): UIDefinition {
  return withSections(
    def,
    def.layout.sections.map(s =>
      s.fields.some(f => f.parameterId === parameterId)
        ? { ...s, fields: s.fields.map(f => (f.parameterId === parameterId ? update(f) : f)) }
        : s
    )
  );
}

export function removeField(def: UIDefinition, parameterId: string): UIDefinition {
  return withSections(
    def,
    def.layout.sections.map(s =>
      s.fields.some(f => f.parameterId === parameterId)
        ? { ...s, fields: renumber(orderedFields(s).filter(f => f.parameterId !== parameterId)) }
        : s
    )
  );
}

/**
 * Moves a field to a section and position. The index is where the field
 * should end up among the target section's fields as they are before the
 * move (a drop "before field N"), so moving down within a section works.
 */
export function moveField(def: UIDefinition, parameterId: string, toSectionId: string, toIndex?: number): UIDefinition {
  const from = findField(def, parameterId);
  if (!from || !def.layout.sections.some(s => s.id === toSectionId)) return def;
  let index = toIndex;
  if (index !== undefined && from.sectionId === toSectionId && from.index < index) index -= 1;
  if (from.sectionId === toSectionId && index === from.index) return def;
  return insertField(removeField(def, parameterId), from.field, toSectionId, index);
}

/** Moves a field one place up or down, across into the neighbouring section at the edges. */
export function nudgeField(def: UIDefinition, parameterId: string, delta: -1 | 1): UIDefinition {
  const from = findField(def, parameterId);
  if (!from) return def;
  const sections = def.layout.sections;
  const sIdx = sections.findIndex(s => s.id === from.sectionId);
  const count = sections[sIdx].fields.length;
  const target = from.index + delta;
  if (target >= 0 && target < count) {
    return moveField(def, parameterId, from.sectionId, delta > 0 ? target + 1 : target);
  }
  const neighbour = sections[sIdx + delta];
  if (!neighbour) return def;
  return moveField(def, parameterId, neighbour.id, delta > 0 ? 0 : neighbour.fields.length);
}

export function canNudge(def: UIDefinition, parameterId: string, delta: -1 | 1): boolean {
  return nudgeField(def, parameterId, delta) !== def;
}

export function removeSection(def: UIDefinition, sectionId: string): UIDefinition {
  return withSections(def, def.layout.sections.filter(s => s.id !== sectionId));
}

export function renameSection(def: UIDefinition, sectionId: string, title: string): UIDefinition {
  return withSections(def, def.layout.sections.map(s => (s.id === sectionId ? { ...s, title } : s)));
}

export function moveSection(def: UIDefinition, sectionId: string, delta: -1 | 1): UIDefinition {
  const sections = [...def.layout.sections];
  const i = sections.findIndex(s => s.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sections.length) return def;
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return withSections(def, sections);
}

/** Which way a widget points: input controls, output displays, or either. */
export function widgetDirection(widget: WidgetType): Direction | 'both' | 'static' {
  switch (widget) {
    case 'gauge':
    case 'badge':
    case 'table':
      return 'output';
    case 'readonly':
    case 'hidden':
      return 'both';
    case 'markdown':
      return 'static';
    default:
      return 'input';
  }
}

/** Whether a widget can show this field (its parameter's type and direction allow it). */
export function widgetFits(widget: WidgetType, field: UIField, param: StepParameter | null): boolean {
  if (field.direction === 'static') return widget === 'markdown';
  if (!param) return false;
  return getCompatibleWidgets(param.type, field.direction).includes(widget);
}

/**
 * The parameter a widget dropped on empty canvas should show: the first one
 * with no field yet that the widget fits, inputs first for input widgets and
 * outputs first otherwise. Null when none fits.
 */
export function parameterForWidget(
  def: UIDefinition,
  step: Step | null,
  widget: WidgetType
): { param: StepParameter; direction: Direction } | null {
  const open = unplacedParameters(def, step);
  const dir = widgetDirection(widget);
  const preferred: Direction[] = dir === 'output' ? ['output'] : dir === 'input' ? ['input'] : ['output', 'input'];
  for (const d of preferred) {
    const hit = open.find(p => p.direction === d && getCompatibleWidgets(p.param.type, d).includes(widget));
    if (hit) return hit;
  }
  return null;
}
