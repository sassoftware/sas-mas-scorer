// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { UISection, UILayout } from '../../types/uiBuilder';
import { WidgetRenderer } from './WidgetRenderer';

interface Props {
  layout: UILayout;
  inputValues: Record<string, unknown>;
  outputValues: Record<string, unknown>;
  onInputChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

// Build a case-insensitive lookup map: lowercased key -> actual value
function buildCaseInsensitiveMap(values: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [key, val] of Object.entries(values)) {
    map.set(key.toLowerCase(), val);
  }
  return map;
}

function lookupValue(
  values: Record<string, unknown>,
  ciMap: Map<string, unknown>,
  key: string,
): unknown | undefined {
  // Try exact match first
  if (key in values) return values[key];
  // Fall back to case-insensitive
  return ciMap.get(key.toLowerCase());
}

export const DynamicForm: React.FC<Props> = ({ layout, inputValues, outputValues, onInputChange, disabled }) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Pre-build case-insensitive map for output values (MAS may return different casing)
  const outputCIMap = buildCaseInsensitiveMap(outputValues);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleFieldChange = (parameterId: string, value: unknown) => {
    onInputChange({ ...inputValues, [parameterId]: value });
  };

  const renderSection = (section: UISection) => {
    const visibleFields = section.fields
      .filter(f => f.visible)
      .sort((a, b) => a.order - b.order);

    if (visibleFields.length === 0) return null;

    const isCollapsed = collapsedSections.has(section.id);

    return (
      <div key={section.id} className="ui-runner__section">
        {section.title && (
          <button
            className="ui-runner__section-header"
            onClick={() => toggleSection(section.id)}
            type="button"
          >
            <span className="ui-runner__section-title">{section.title}</span>
            <svg
              className={`ui-runner__section-chevron ${isCollapsed ? '' : 'ui-runner__section-chevron--open'}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {!isCollapsed && (
          <div className={`ui-runner__fields ui-runner__fields--cols-${layout.columns}`}>
            {visibleFields.map(field => {
              const isInput = field.direction === 'input';
              const isStatic = field.direction === 'static';
              const value = isStatic
                ? (field.defaultValue ?? null)
                : isInput
                  ? (inputValues[field.parameterId] ?? field.defaultValue ?? null)
                  : (lookupValue(outputValues, outputCIMap, field.parameterId) ?? field.defaultValue ?? null);

              return (
                <div
                  key={field.parameterId}
                  className={`ui-runner__field ui-runner__field--${field.width}`}
                >
                  {field.widget !== 'hidden' && field.widget !== 'markdown' && (
                    <label className="ui-runner__field-label">
                      {field.label}
                      {field.description && (
                        <span className="ui-runner__field-hint" title={field.description}>?</span>
                      )}
                    </label>
                  )}
                  <WidgetRenderer
                    field={field}
                    value={value}
                    onChange={isInput ? (v) => handleFieldChange(field.parameterId, v) : undefined}
                    disabled={disabled || !isInput || isStatic}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ui-runner__form">
      {layout.sections.map(renderSection)}
    </div>
  );
};
