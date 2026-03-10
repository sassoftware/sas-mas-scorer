// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Step, StepParameter, StepParameterType } from '../types';
import {
  UIDefinition,
  UIField,
  UISection,
  UISettings,
  WidgetType,
} from '../types/uiBuilder';

let counter = 0;
function generateId(): string {
  return `${Date.now()}-${++counter}`;
}

/**
 * Map a step parameter type to its default widget.
 */
export function getDefaultWidget(type: StepParameterType, direction: 'input' | 'output'): WidgetType {
  if (direction === 'output') {
    if (type === 'decimal') return 'gauge';
    if (type === 'string') return 'badge';
    return 'readonly';
  }

  switch (type) {
    case 'decimal':
    case 'integer':
    case 'bigint':
      return 'number';
    case 'string':
      return 'text';
    case 'binary':
    case 'decimalArray':
    case 'integerArray':
    case 'bigintArray':
    case 'stringArray':
    case 'binaryArray':
      return 'textarea';
    default:
      return 'text';
  }
}

/**
 * Get compatible widgets for a parameter type and direction.
 */
export function getCompatibleWidgets(type: StepParameterType, direction: 'input' | 'output'): WidgetType[] {
  if (direction === 'output') {
    if (type === 'decimal' || type === 'integer' || type === 'bigint') {
      return ['readonly', 'gauge', 'badge', 'hidden'];
    }
    if (type === 'string') {
      return ['readonly', 'badge', 'hidden'];
    }
    return ['readonly', 'hidden'];
  }

  switch (type) {
    case 'decimal':
      return ['number', 'slider', 'text', 'readonly', 'hidden'];
    case 'integer':
    case 'bigint':
      return ['number', 'slider', 'text', 'readonly', 'hidden'];
    case 'string':
      return ['text', 'dropdown', 'radio', 'textarea', 'readonly', 'hidden'];
    case 'binary':
      return ['textarea', 'readonly', 'hidden'];
    default:
      // Array types
      return ['textarea', 'readonly', 'hidden'];
  }
}

function paramToField(param: StepParameter, direction: 'input' | 'output', order: number): UIField {
  return {
    parameterId: param.name,
    direction,
    label: param.name,
    widget: getDefaultWidget(param.type, direction),
    visible: true,
    order,
    width: param.type.endsWith('Array') || param.type === 'binary' ? 'full' : 'half',
    placeholder: direction === 'input' ? `Enter ${param.name}` : undefined,
  };
}

/**
 * Generate a default UIDefinition from a step's schema.
 */
export function generateDefaultUI(
  moduleId: string,
  step: Step,
  name?: string
): UIDefinition {
  const inputFields: UIField[] = (step.inputs ?? []).map((p, i) =>
    paramToField(p, 'input', i)
  );
  const outputFields: UIField[] = (step.outputs ?? []).map((p, i) =>
    paramToField(p, 'output', i)
  );

  const sections: UISection[] = [];

  if (inputFields.length > 0) {
    sections.push({
      id: generateId(),
      title: 'Inputs',
      fields: inputFields,
    });
  }

  if (outputFields.length > 0) {
    sections.push({
      id: generateId(),
      title: 'Results',
      fields: outputFields,
    });
  }

  const settings: UISettings = {
    submitLabel: step.id.toLowerCase().startsWith('execute') ? 'Execute' : 'Score',
    showExecutionTime: true,
    theme: 'default',
    outputLayout: 'below',
  };

  const now = new Date().toISOString();

  return {
    id: generateId(),
    name: name ?? `${moduleId} UI`,
    moduleId,
    stepId: step.id,
    createdAt: now,
    updatedAt: now,
    layout: {
      columns: 2,
      sections,
    },
    settings,
  };
}
