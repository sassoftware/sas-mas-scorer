// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { UIDefinition } from '../../../types/uiBuilder';
import { Step, StepParameter } from '../../../types';
import { Direction, findField, isPlaced } from './canvasOps';
import { startDrag } from './dnd';

interface Props {
  definition: UIDefinition;
  step: Step | null;
  /** Where the app scores, shown under its name. */
  source: string;
  selectedFieldId: string | null;
  onSelectField: (parameterId: string) => void;
  onAddParameter: (param: StepParameter, direction: Direction) => void;
  onDragStateChange: (dragging: boolean) => void;
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/**
 * The module's (or endpoint's) signature: every input and result, with the
 * ones already on the page selectable and the others one click from it.
 */
export const FieldsPanel: React.FC<Props> = ({
  definition,
  step,
  source,
  selectedFieldId,
  onSelectField,
  onAddParameter,
  onDragStateChange,
}) => {
  const group = (title: string, params: StepParameter[], direction: Direction) => (
    <section className="cb-fields__group" aria-labelledby={`cb-fields-${direction}`}>
      <h3 className="cb-fields__heading" id={`cb-fields-${direction}`}>{title}</h3>
      {params.length === 0 ? (
        <p className="cb-fields__empty">None in the signature</p>
      ) : (
        <ul className="cb-fields__list">
          {params.map(param => {
            const placed = isPlaced(definition, param.name);
            const location = placed ? findFieldByName(definition, param.name) : null;
            const selected = !!location && location === selectedFieldId;
            const badge = direction === 'input' ? 'IN' : 'OUT';
            return (
              <li key={param.name}>
                <button
                  type="button"
                  className={`cb-fields__item${selected ? ' cb-fields__item--selected' : ''}${placed ? '' : ' cb-fields__item--open'}`}
                  aria-pressed={placed ? selected : undefined}
                  aria-label={placed
                    ? `${param.name}, ${direction}, ${param.type}: select it on the canvas`
                    : `${param.name}, ${direction}, ${param.type}: not on the page yet, add it`}
                  draggable
                  onDragStart={(e) => {
                    if (location) startDrag(e, { kind: 'field', parameterId: location });
                    else startDrag(e, { kind: 'param', name: param.name, direction });
                    onDragStateChange(true);
                  }}
                  onDragEnd={() => onDragStateChange(false)}
                  onClick={() => (location ? onSelectField(location) : onAddParameter(param, direction))}
                >
                  <span className="cb-fields__name">{param.name}</span>
                  <span className={`sas-badge sas-badge--small sas-badge--direction-${direction}`} aria-hidden="true">{badge}</span>
                  {!placed && <span className="cb-fields__add" aria-hidden="true"><PlusIcon /></span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <nav className="cb-fields" aria-label="Module fields">
      <div className="cb-fields__app">
        <span className="cb-fields__eyebrow">UI app</span>
        <span className="cb-fields__app-name">{definition.name}</span>
        <span className="cb-fields__source">{source}</span>
      </div>
      {!step ? (
        <p className="cb-fields__empty">Reading the signature…</p>
      ) : (
        <>
          {group('Inputs', step.inputs ?? [], 'input')}
          {group('Results', step.outputs ?? [], 'output')}
        </>
      )}
    </nav>
  );
};

/** The parameterId of the field showing this parameter (names compare case-insensitively). */
function findFieldByName(def: UIDefinition, name: string): string | null {
  for (const s of def.layout.sections) {
    const f = s.fields.find(x => x.direction !== 'static' && x.parameterId.toLowerCase() === name.toLowerCase());
    if (f) return findField(def, f.parameterId)?.field.parameterId ?? null;
  }
  return null;
}
