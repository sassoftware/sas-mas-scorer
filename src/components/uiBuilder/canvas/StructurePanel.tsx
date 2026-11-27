// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { SubmitPosition, UIDefinition, UIField } from '../../../types/uiBuilder';
import { Step, StepParameter } from '../../../types';
import { getSubmitPosition, lastInputSectionId } from '../../../utils/uiDefaults';
import { MenuButton, MenuItem } from '../../common/MenuButton';
import { Direction, orderedFields, unplacedParameters } from './canvasOps';
import { startDrag } from './dnd';
import { Selection } from './FormCanvas';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  /** Where the app scores, shown under its name. */
  source: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Adds a field for a parameter; without a section it goes where its kind usually goes. */
  onAddParameter: (param: StepParameter, direction: Direction, sectionId?: string) => void;
  onAddTextBlock: (sectionId: string) => void;
  onAddSection: () => void;
  onDragStateChange: (dragging: boolean) => void;
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l10-6.5z" />
  </svg>
);

const KIND: Record<UIField['direction'], { badge: string; className: string; spoken: string }> = {
  input: { badge: 'IN', className: 'sas-badge--direction-input', spoken: 'input' },
  output: { badge: 'OUT', className: 'sas-badge--direction-output', spoken: 'result' },
  static: { badge: 'TEXT', className: 'sas-badge--direction-both', spoken: 'text block' },
};

const SUBMIT_PLACE: Record<SubmitPosition, string> = {
  top: 'at the top',
  afterInputs: 'after the inputs',
  bottom: 'at the bottom',
};

/**
 * The left panel: the app's structure in page order (sections, their fields
 * and the run button), with what each item is, and ways to add fields, text
 * and sections. Inputs and results not on the page yet are listed under it.
 */
export const StructurePanel: React.FC<Props> = ({
  definition,
  step,
  source,
  selection,
  onSelect,
  onAddParameter,
  onAddTextBlock,
  onAddSection,
  onDragStateChange,
}) => {
  const sections = definition.layout.sections;
  const open = unplacedParameters(definition, step);
  const submitPosition = getSubmitPosition(definition.settings);
  const inputAnchor = lastInputSectionId(definition.layout);
  const submitLabel = definition.settings.submitLabel || 'Execute';
  const appSelected = selection?.kind === 'app';

  const submitRow = (position: SubmitPosition) => position === submitPosition && (
    <li className="cb-tree__submit-item">
      <button
        type="button"
        className="cb-tree__row cb-tree__row--submit"
        aria-label={`Run button "${submitLabel}", ${SUBMIT_PLACE[position]}: app settings`}
        onClick={() => onSelect({ kind: 'app' })}
      >
        <span className="cb-tree__icon"><PlayIcon /></span>
        <span className="cb-tree__name">Run button</span>
        <span className="cb-tree__hint">{submitLabel}</span>
      </button>
    </li>
  );

  const addItems = (sectionId: string): MenuItem[] => [
    ...open.filter(p => p.direction === 'input').map(p => ({
      id: `in-${p.param.name}`,
      label: p.param.name,
      description: p.param.type,
      group: 'Inputs not on the page',
      onSelect: () => onAddParameter(p.param, 'input', sectionId),
    })),
    ...open.filter(p => p.direction === 'output').map(p => ({
      id: `out-${p.param.name}`,
      label: p.param.name,
      description: p.param.type,
      group: 'Results not on the page',
      onSelect: () => onAddParameter(p.param, 'output', sectionId),
    })),
    {
      id: 'text',
      label: 'Text block',
      description: 'Formatted text, instructions or an image',
      group: 'Text',
      onSelect: () => onAddTextBlock(sectionId),
    },
  ];

  const fieldRow = (field: UIField) => {
    const selected = selection?.kind === 'field' && selection.id === field.parameterId;
    const kind = KIND[field.direction];
    return (
      <li key={field.parameterId}>
        <button
          type="button"
          className={`cb-tree__row cb-tree__row--field${selected ? ' cb-tree__row--selected' : ''}${field.visible ? '' : ' cb-tree__row--hidden'}`}
          aria-pressed={selected}
          aria-label={`${field.label}, ${kind.spoken}${field.visible ? '' : ', hidden'}`}
          title={field.direction === 'static' ? undefined : field.parameterId}
          draggable
          onDragStart={(e) => {
            startDrag(e, { kind: 'field', parameterId: field.parameterId });
            onDragStateChange(true);
          }}
          onDragEnd={() => onDragStateChange(false)}
          onClick={() => onSelect({ kind: 'field', id: field.parameterId })}
        >
          <span className="cb-tree__name">{field.label}</span>
          {!field.visible && <span className="cb-tree__hint">hidden</span>}
          <span className={`sas-badge sas-badge--small ${kind.className}`} aria-hidden="true">{kind.badge}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className="cb-tree" aria-label="App structure">
      <div className="cb-tree__app">
        <span className="cb-tree__eyebrow">UI app</span>
        <span className="cb-tree__app-name">{definition.name || 'Untitled app'}</span>
        <span className="cb-tree__source">{source}</span>
      </div>

      <button
        type="button"
        className={`cb-tree__row cb-tree__row--app${appSelected ? ' cb-tree__row--selected' : ''}`}
        aria-pressed={appSelected}
        onClick={() => onSelect({ kind: 'app' })}
      >
        <span className="cb-tree__icon"><GearIcon /></span>
        <span className="cb-tree__name">Title, layout and columns</span>
      </button>

      <h3 className="cb-tree__heading" id="cb-tree-structure">Structure</h3>
      <p className="cb-tree__legend" aria-hidden="true">
        <span className="sas-badge sas-badge--small sas-badge--direction-input">IN</span> input
        <span className="sas-badge sas-badge--small sas-badge--direction-output">OUT</span> result
        <span className="sas-badge sas-badge--small sas-badge--direction-both">TEXT</span> text
      </p>

      {!step && sections.length === 0 ? (
        <p className="cb-tree__empty">Reading the signature…</p>
      ) : (
        <ul className="cb-tree__sections" aria-labelledby="cb-tree-structure">
          {submitRow('top')}
          {sections.map(section => {
            const fields = orderedFields(section);
            const selected = selection?.kind === 'section' && selection.id === section.id;
            const title = section.title || 'Untitled section';
            return (
              <React.Fragment key={section.id}>
                <li className="cb-tree__section">
                  <button
                    type="button"
                    className={`cb-tree__row cb-tree__row--section${selected ? ' cb-tree__row--selected' : ''}`}
                    aria-pressed={selected}
                    aria-label={`Section ${title}, ${fields.length} item${fields.length === 1 ? '' : 's'}`}
                    onClick={() => onSelect({ kind: 'section', id: section.id })}
                  >
                    <span className="cb-tree__name">{title}</span>
                    <span className="cb-tree__count" aria-hidden="true">{fields.length}</span>
                  </button>
                  <ul className="cb-tree__fields" aria-label={`In ${title}`}>
                    {fields.map(fieldRow)}
                    <li>
                      <MenuButton
                        label={<><PlusIcon /> Add</>}
                        ariaLabel={`Add a field or text to ${title}`}
                        items={addItems(section.id)}
                        triggerClassName="cb-tree__add"
                        hideChevron
                        floating
                      />
                    </li>
                  </ul>
                </li>
                {section.id === inputAnchor && submitRow('afterInputs')}
              </React.Fragment>
            );
          })}
          {!inputAnchor && submitRow('afterInputs')}
          {submitRow('bottom')}
        </ul>
      )}

      <button type="button" className="cb-tree__add cb-tree__add--section" onClick={onAddSection}>
        <PlusIcon /> Add section
      </button>

      {open.length > 0 && (
        <section className="cb-tree__open" aria-labelledby="cb-tree-open">
          <h3 className="cb-tree__heading" id="cb-tree-open">Not on the page ({open.length})</h3>
          <ul className="cb-tree__fields cb-tree__fields--open">
            {open.map(({ param, direction }) => {
              const kind = KIND[direction];
              return (
                <li key={`${direction}-${param.name}`}>
                  <button
                    type="button"
                    className="cb-tree__row cb-tree__row--open"
                    aria-label={`${param.name}, ${kind.spoken}, ${param.type}: add it to the page`}
                    draggable
                    onDragStart={(e) => {
                      startDrag(e, { kind: 'param', name: param.name, direction });
                      onDragStateChange(true);
                    }}
                    onDragEnd={() => onDragStateChange(false)}
                    onClick={() => onAddParameter(param, direction)}
                  >
                    <span className="cb-tree__name">{param.name}</span>
                    <span className={`sas-badge sas-badge--small ${kind.className}`} aria-hidden="true">{kind.badge}</span>
                    <span className="cb-tree__plus" aria-hidden="true"><PlusIcon /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </nav>
  );
};
