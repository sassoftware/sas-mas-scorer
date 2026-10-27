// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useRef, useState } from 'react';
import { UISection, UILayout, UIField, FieldErrors } from '../../types/uiBuilder';
import { StepParameter } from '../../types';
import { findParameter } from '../../utils/uiDefaults';
import { WidgetRenderer } from './WidgetRenderer';

interface Props {
  layout: UILayout;
  inputValues: Record<string, unknown>;
  outputValues: Record<string, unknown>;
  onInputChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  /** The step's input parameters, so widgets know the declared type. */
  inputParameters?: StepParameter[];
  /** Inline problems by field parameter id, from the pre-run check. */
  fieldErrors?: FieldErrors;
  /**
   * Bump to open the sections holding errors and move focus to the first
   * invalid field (after a blocked run).
   */
  focusErrorsRequest?: number;
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

/** Widgets a <label for> can name (a button counts; a radio group does not). */
const LABELABLE = new Set(['text', 'number', 'slider', 'dropdown', 'toggle', 'textarea']);

/** "Min 0 · Max 100" / "Up to 20 characters": the author's limits, stated up front. */
function constraintHint(field: UIField): string | null {
  const v = field.validation;
  if (!v) return null;
  if (field.widget === 'number' || field.widget === 'text') {
    const parts: string[] = [];
    if (field.widget === 'number' && v.min !== undefined) parts.push(`Min ${v.min}`);
    if (field.widget === 'number' && v.max !== undefined) parts.push(`Max ${v.max}`);
    if (field.widget === 'text' && v.maxLength) parts.push(`Up to ${v.maxLength} characters`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (field.widget === 'textarea' && v.maxLength) return `Up to ${v.maxLength} characters`;
  return null;
}

export const DynamicForm: React.FC<Props> = ({
  layout,
  inputValues,
  outputValues,
  onInputChange,
  disabled,
  inputParameters,
  fieldErrors,
  focusErrorsRequest,
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const idPrefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Renders left in which to find the first invalid field: one now, one more
  // after a collapsed section holding it has opened.
  const focusAttemptsRef = useRef(0);

  // Pre-build case-insensitive map for output values (MAS may return different casing)
  const outputCIMap = buildCaseInsensitiveMap(outputValues);

  useEffect(() => {
    if (!focusErrorsRequest) return;
    const invalid = new Set(Object.keys(fieldErrors ?? {}));
    setCollapsedSections(prev => {
      const next = new Set(prev);
      for (const s of layout.sections) {
        if (s.fields.some(f => invalid.has(f.parameterId))) next.delete(s.id);
      }
      return next.size === prev.size ? prev : next;
    });
    focusAttemptsRef.current = 2;
    // Only a new request moves focus; edits that change the errors do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusErrorsRequest]);

  useEffect(() => {
    if (focusAttemptsRef.current === 0) return;
    focusAttemptsRef.current -= 1;
    const wrapper = rootRef.current?.querySelector('[data-invalid="true"]');
    const control = wrapper?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    if (control) {
      control.focus();
      focusAttemptsRef.current = 0;
    }
  });

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

  const renderSection = (section: UISection, sIdx: number) => {
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
            aria-expanded={!isCollapsed}
          >
            <span className="ui-runner__section-title">{section.title}</span>
            <svg
              className={`ui-runner__section-chevron ${isCollapsed ? '' : 'ui-runner__section-chevron--open'}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        {!isCollapsed && (
          <div className={`ui-runner__fields ui-runner__fields--cols-${layout.columns}`}>
            {visibleFields.map((field, fIdx) => {
              const isInput = field.direction === 'input';
              const isStatic = field.direction === 'static';
              // An input the user cleared stays cleared: the form is seeded
              // with every default, so only a field never seeded falls back.
              const value = isStatic
                ? (field.defaultValue ?? null)
                : isInput
                  ? (field.parameterId in inputValues
                    ? inputValues[field.parameterId] ?? null
                    : field.defaultValue ?? null)
                  : (lookupValue(outputValues, outputCIMap, field.parameterId) ?? field.defaultValue ?? null);

              const baseId = `${idPrefix}-s${sIdx}-f${fIdx}`;
              const controlId = `${baseId}-control`;
              const labelId = `${baseId}-label`;
              const errorId = `${baseId}-error`;
              const hintId = `${baseId}-hint`;
              const error = isInput ? fieldErrors?.[field.parameterId] : undefined;
              const hint = isInput ? constraintHint(field) : null;
              const required = isInput && !!field.validation?.required;
              const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
              const labelable = isInput && LABELABLE.has(field.widget);

              return (
                <div
                  key={field.parameterId}
                  className={`ui-runner__field ui-runner__field--${field.width}${error ? ' ui-runner__field--invalid' : ''}`}
                  data-invalid={error ? 'true' : undefined}
                >
                  {field.widget !== 'hidden' && field.widget !== 'markdown' && (
                    <label
                      className="ui-runner__field-label"
                      id={labelId}
                      htmlFor={labelable ? controlId : undefined}
                    >
                      {field.label}
                      {required && <span className="ui-runner__field-required" aria-hidden="true">*</span>}
                      {field.description && (
                        <span
                          className="ui-runner__field-hint"
                          data-tooltip={field.description}
                          tabIndex={0}
                          role="img"
                          aria-label={field.description}
                        >
                          ?
                        </span>
                      )}
                    </label>
                  )}
                  <WidgetRenderer
                    field={field}
                    value={value}
                    onChange={isInput ? (v) => handleFieldChange(field.parameterId, v) : undefined}
                    disabled={disabled || !isInput || isStatic}
                    parameter={isInput && inputParameters ? findParameter(inputParameters, field.parameterId) : undefined}
                    id={isInput ? controlId : undefined}
                    labelId={labelId}
                    describedBy={describedBy}
                    invalid={!!error}
                  />
                  {hint && (
                    <span id={hintId} className="ui-runner__field-constraint">{hint}</span>
                  )}
                  {error && (
                    <span id={errorId} className="ui-runner__field-error">{error}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ui-runner__form" ref={rootRef}>
      {layout.sections.map(renderSection)}
    </div>
  );
};
