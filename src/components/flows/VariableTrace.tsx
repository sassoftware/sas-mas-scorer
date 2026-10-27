// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useId } from 'react';
import {
  MAPPED_CAVEAT, TRACE_CAVEAT, TRACE_ROLE_LABELS, variableKey, type TraceRole,
} from '../../flow/variableUsage';
import { Button } from '../common';

/** One node in a trace's jump list. */
export interface TraceListItem {
  id: string;
  label: string;
  typeLabel: string;
  /** Containing sub-decisions / parallel groups, outermost first. */
  path: string[];
  role: TraceRole;
}

/** What the side panel shows for the traced variable. */
export interface TraceInfo {
  /** The variable as the decision spells it. */
  variable: string;
  /** Nodes whose own terms read or write it. */
  logic: TraceListItem[];
  /** Nodes it is only mapped into or out of. */
  mapped: TraceListItem[];
  /** Nodes that declare nothing, so may use it unseen. */
  notChecked: TraceListItem[];
}

interface TraceVariableButtonProps {
  name: string;
  /** The variable traced now, if any. */
  traced?: string | null;
  onTrace: (name: string) => void;
  className?: string;
}

/**
 * A variable name that starts (or, when it is the traced one, ends) a
 * "Where is it used" trace. A toggle button: aria-pressed tells which one
 * is on, and its name reads "Where <name> is used".
 */
export function TraceVariableButton({ name, traced, onTrace, className }: TraceVariableButtonProps) {
  const pressed = !!traced && variableKey(traced) === variableKey(name);
  return (
    <button
      type="button"
      className={`flow-trace-var${pressed ? ' flow-trace-var--active' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      title={pressed ? `Stop showing where ${name} is used` : `Show where ${name} is used in the diagram`}
      onClick={() => onTrace(name)}
    >
      <span className="sr-only">Where </span>
      {name}
      <span className="sr-only"> is used</span>
    </button>
  );
}

function roleClass(role: TraceRole): string {
  switch (role) {
    case 'reads': case 'mapped-in': return 'sas-badge sas-badge--direction-input';
    case 'writes': case 'mapped-out': return 'sas-badge sas-badge--direction-output';
    case 'both': case 'mapped-both': return 'sas-badge sas-badge--direction-both';
    default: return 'sas-badge sas-badge--default';
  }
}

function JumpList({ items, selectedId, onJump }: {
  items: TraceListItem[]; selectedId?: string | null; onJump: (id: string) => void;
}) {
  return (
    <ul className="flow-trace__list">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="flow-trace__jump"
            aria-current={item.id === selectedId ? 'true' : undefined}
            onClick={() => onJump(item.id)}
          >
            <span className={`flow-trace__role ${roleClass(item.role)}`}>{TRACE_ROLE_LABELS[item.role]}</span>
            <span className="flow-trace__node">
              <span className="flow-trace__node-label">{item.label}</span>
              <span className="flow-trace__node-meta">
                {item.typeLabel}
                {item.path.length > 0 && <> · in {item.path.join(' › ')}</>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface VariableTraceSectionProps {
  trace: TraceInfo;
  selectedId?: string | null;
  onJump: (id: string) => void;
  onClear: () => void;
}

/** The side panel's "Where <variable> is used" section: jump lists and what they cannot show. */
export function VariableTraceSection({ trace, selectedId, onJump, onClear }: VariableTraceSectionProps) {
  const headingId = useId();
  const { variable, logic, mapped, notChecked } = trace;
  const nothing = logic.length === 0 && mapped.length === 0;
  return (
    <section className="flow-trace" aria-labelledby={headingId}>
      <div className="flow-trace__head">
        <h3 id={headingId} className="flow-trace__title">
          Where <code className="flow-trace__var">{variable}</code> is used
        </h3>
        <Button variant="secondary" size="small" onClick={onClear}>Clear trace</Button>
      </div>
      <p className="flow-trace__caveat">{TRACE_CAVEAT}</p>

      {nothing && (
        <p className="flow-trace__empty">
          No node in the loaded diagram reads, writes or maps {variable}
          {notChecked.length > 0 ? ', but the nodes under "Not checked" may use it.' : '.'}
        </p>
      )}

      {logic.length > 0 && (
        <>
          <h4 className="flow-side-panel__section-title">Read or written by its rules or terms ({logic.length})</h4>
          <JumpList items={logic} selectedId={selectedId} onJump={onJump} />
        </>
      )}

      {mapped.length > 0 && (
        <>
          <h4 className="flow-side-panel__section-title">Mapped into or out of ({mapped.length})</h4>
          <JumpList items={mapped} selectedId={selectedId} onJump={onJump} />
          <p className="flow-trace__caveat">{MAPPED_CAVEAT}</p>
        </>
      )}

      {notChecked.length > 0 && (
        <details className="flow-trace__unchecked">
          <summary>Not checked ({notChecked.length}): no mappings declared</summary>
          <p className="flow-trace__caveat">
            These nodes declare no input or output mappings, so the app cannot tell whether they use {variable}.
          </p>
          <JumpList items={notChecked} selectedId={selectedId} onJump={onJump} />
        </details>
      )}
    </section>
  );
}

/** The toolbar line above the canvas while a variable is traced. */
export function TraceSummaryBar({ trace, onClear }: { trace: TraceInfo; onClear: () => void }) {
  const count = (roles: TraceRole[]) => [...trace.logic, ...trace.mapped].filter((i) => roles.includes(i.role)).length;
  const writes = count(['writes', 'both']);
  const reads = count(['reads', 'both']);
  const mapped = trace.mapped.length;
  const parts = [
    `${writes} write${writes === 1 ? 's' : ''}`,
    `${reads} read${reads === 1 ? 's' : ''}`,
    `${mapped} mapped`,
  ];
  if (trace.notChecked.length > 0) parts.push(`${trace.notChecked.length} not checked`);
  return (
    <div className="flow-trace-bar">
      <span role="status" className="flow-trace-bar__text">
        Where <code className="flow-trace__var">{trace.variable}</code> is used: {parts.join(' · ')}
      </span>
      <span className="flow-trace-bar__legend" aria-hidden="true">
        <span className="flow-trace-bar__key flow-trace-bar__key--writes">solid = writes</span>
        <span className="flow-trace-bar__key flow-trace-bar__key--reads">dashed = reads</span>
        <span className="flow-trace-bar__key flow-trace-bar__key--mapped">dotted = mapped</span>
      </span>
      <Button variant="tertiary" size="small" onClick={onClear}>Clear trace</Button>
    </div>
  );
}
