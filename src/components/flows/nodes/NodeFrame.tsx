// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, type ReactNode } from 'react';
import { TRACE_ROLE_LABELS, type TraceRole } from '../../../flow/variableUsage';

/**
 * The variable being traced, as each node's part in it. Handed to the node
 * components through context so a trace changes only styling: the node
 * objects, and with them React Flow's layout and measurements, stay as they
 * are. `null` when nothing is traced.
 */
export const FlowTraceContext = createContext<ReadonlyMap<string, TraceRole> | null>(null);

const ROLE_TAGS: Record<TraceRole, { className: string; title: string }> = {
  writes: { className: 'sas-badge sas-badge--direction-output', title: 'Its rules or assignments set the variable' },
  reads: { className: 'sas-badge sas-badge--direction-input', title: 'Its rules or condition read the variable' },
  both: { className: 'sas-badge sas-badge--direction-both', title: 'Its rules read and set the variable' },
  'mapped-in': {
    className: 'sas-badge sas-badge--direction-input',
    title: 'The variable is mapped into this node; how it is used inside is not visible',
  },
  'mapped-out': {
    className: 'sas-badge sas-badge--direction-output',
    title: 'The variable is mapped out of this node; how it is set inside is not visible',
  },
  'mapped-both': {
    className: 'sas-badge sas-badge--direction-both',
    title: 'The variable is mapped in and out of this node; how it is used inside is not visible',
  },
  unknown: {
    className: 'sas-badge sas-badge--default',
    title: 'This node declares no mappings, so the app cannot tell whether it uses the variable',
  },
};

interface NodeFrameProps {
  id: string;
  selected?: boolean;
  /** The node's referenced object could not be loaded. */
  unavailable?: boolean;
  children: ReactNode;
}

/**
 * The state every node shape shares, drawn around it without changing its
 * size: the selected ring, the trace ring and tag (line style and text, not
 * colour alone: solid = writes, dashed = reads, dotted = mapping only),
 * dimming of nodes outside the trace, and the "Unavailable" badge. The tags
 * sit above the shape, outside its measured box.
 */
export default function NodeFrame({ id, selected, unavailable, children }: NodeFrameProps) {
  const roles = useContext(FlowTraceContext);
  const role = roles?.get(id);
  const classes = ['flow-node'];
  if (selected) classes.push('flow-node--selected');
  if (role) classes.push(`flow-node--trace-${role}`);
  else if (roles) classes.push('flow-node--dimmed');

  const tag = role ? ROLE_TAGS[role] : null;
  return (
    <div className={classes.join(' ')}>
      {selected && <span className="sr-only">Selected. </span>}
      {(tag || unavailable) && (
        <div className="flow-node__tags">
          {tag && role && <span className={`flow-node__tag ${tag.className}`} title={tag.title}>{TRACE_ROLE_LABELS[role]}</span>}
          {unavailable && (
            <span
              className="flow-node__tag sas-badge sas-badge--warning"
              title="The object this node references could not be loaded; its details and badges are missing"
            >
              <span aria-hidden="true">&#9888;</span>&nbsp;Unavailable
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** The `unavailable` flag the graph conversion sets on a node's data. */
export function isUnavailable(data: Record<string, unknown>): boolean {
  return data.unavailable === true;
}
