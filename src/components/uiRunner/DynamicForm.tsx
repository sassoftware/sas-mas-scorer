// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useRef, useState } from 'react';
import { UISection, UILayout, UIField, FieldErrors, SubmitPosition } from '../../types/uiBuilder';
import { StepParameter } from '../../types';
import { effectiveWidth, findParameter, lastInputSectionId, safeColor } from '../../utils/uiDefaults';
import { WidgetRenderer } from './WidgetRenderer';
import { conditionHolds } from '../../utils/showWhen';

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
  /**
   * The run button, drawn inside the form: at the top, or after the last
   * section with inputs. (At the bottom the runner draws it under the form.)
   */
  submit?: { node: React.ReactNode; position: Exclude<SubmitPosition, 'bottom'> };
  /** Tabs or steps (3.1): the index (among the shown sections) of the one on screen. */
  active?: number;
  onActiveChange?: (index: number) => void;
  /** Steps (3.1): the Back / Next / run buttons under the current step. */
  stepNav?: React.ReactNode;
}

/** The sections the runner shows: those with at least one visible field. */
export const shownSections = (layout: UILayout): UISection[] =>
  layout.sections.filter(s => s.fields.some(f => f.visible));

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
const LABELABLE = new Set(['text', 'number', 'slider', 'dropdown', 'toggle', 'textarea', 'checkbox', 'date', 'datetime', 'file', 'percent', 'currency']);

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
  submit,
  active = 0,
  onActiveChange,
  stepNav,
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

  const renderSection = (section: UISection, sIdx: number, plain = false) => {
    const visibleFields = section.fields
      .filter(f => f.visible && conditionHolds(f, { layout }, inputValues, outputValues))
      .sort((a, b) => a.order - b.order);

    if (visibleFields.length === 0) return null;

    const isCollapsed = !plain && collapsedSections.has(section.id);

    return (
      <div
        key={section.id}
        className={`ui-runner__section${safeColor(section.color) ? ' ui-runner__section--colored' : ''}`}
        style={safeColor(section.color) ? ({ '--section-color': section.color } as React.CSSProperties) : undefined}
      >
        {section.title && !plain && (
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
                  className={`ui-runner__field ui-runner__field--${effectiveWidth(field, layout.columns)}${error ? ' ui-runner__field--invalid' : ''}`}
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

  const display = layout.display ?? 'page';
  const shown = shownSections(layout);
  const current = Math.min(Math.max(active, 0), Math.max(shown.length - 1, 0));

  if (display === 'tabs' && shown.length > 0) {
    const onKey = (e: React.KeyboardEvent) => {
      const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      let next = current;
      if (delta) next = (current + delta + shown.length) % shown.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = shown.length - 1;
      else return;
      e.preventDefault();
      onActiveChange?.(next);
      rootRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idPrefix}-tab-${next}`)}`)?.focus();
    };
    return (
      <div className="ui-runner__form ui-runner__form--tabs" ref={rootRef}>
        {submit?.position === 'top' && <div className="ui-runner__submit">{submit.node}</div>}
        <div className="ui-runner__tabs" role="tablist" aria-label="Sections" onKeyDown={onKey}>
          {shown.map((s, i) => (
            <button
              key={s.id}
              id={`${idPrefix}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={i === current ? 0 : -1}
              className={`ui-runner__tab${i === current ? ' ui-runner__tab--on' : ''}`}
              onClick={() => onActiveChange?.(i)}
            >
              {s.title || `Section ${i + 1}`}
            </button>
          ))}
        </div>
        <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${current}`} tabIndex={0}>
          {renderSection(shown[current], layout.sections.indexOf(shown[current]), true)}
        </div>
      </div>
    );
  }

  if (display === 'steps' && shown.length > 0) {
    const s = shown[current];
    return (
      <div className="ui-runner__form ui-runner__form--steps" ref={rootRef}>
        <div className="ui-runner__steps-head">
          <ol className="ui-runner__steps-track" aria-hidden="true">
            {shown.map((x, i) => (
              <li key={x.id} className={i < current ? 'ui-runner__step--done' : i === current ? 'ui-runner__step--on' : ''} />
            ))}
          </ol>
          <h4 className="ui-runner__steps-title" aria-live="polite">
            Step {current + 1} of {shown.length}{s.title ? `: ${s.title}` : ''}
          </h4>
        </div>
        {renderSection(s, layout.sections.indexOf(s), true)}
        {stepNav}
      </div>
    );
  }

  const submitAfter = submit?.position === 'afterInputs' ? lastInputSectionId(layout) : null;
  const submitNode = submit && <div className="ui-runner__submit">{submit.node}</div>;

  return (
    <div className="ui-runner__form" ref={rootRef}>
      {submit?.position === 'top' && submitNode}
      {layout.sections.map((section, i) => (
        <React.Fragment key={section.id}>
          {renderSection(section, i)}
          {submitAfter === section.id && submitNode}
        </React.Fragment>
      ))}
      {submit?.position === 'afterInputs' && !submitAfter && submitNode}
    </div>
  );
};
